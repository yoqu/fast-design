import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { importClaudeDesignZip } from './claude-design-import.js';

// ---- 手工 ZIP 构造器：完全控制 flag/method/size 字段（解析器不校验 CRC，置 0 即可） ----

type TestEntry = {
  name: string;
  body?: string | Buffer;
  method?: 0 | 8;
  flags?: number; // bit0 = encrypted
  uncompressedSizeOverride?: number;
};

function buildTestZip(entries: TestEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const body = Buffer.isBuffer(e.body) ? e.body : Buffer.from(e.body ?? '', 'utf8');
    const method = e.method ?? 8;
    const data = method === 8 ? deflateRawSync(body) : body;
    const flags = e.flags ?? 0;
    const uncompressedSize = e.uncompressedSizeOverride ?? body.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const tmpRoots: string[] = [];

function makeTmp(): { zipPath: string; projectDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cdi-test-'));
  tmpRoots.push(root);
  return { zipPath: path.join(root, 'in.zip'), projectDir: path.join(root, 'proj') };
}

async function runImport(entries: TestEntry[]) {
  const { zipPath, projectDir } = makeTmp();
  fs.writeFileSync(zipPath, buildTestZip(entries));
  const result = await importClaudeDesignZip(zipPath, projectDir);
  return { result, projectDir };
}

afterAll(() => {
  for (const root of tmpRoots) fs.rmSync(root, { recursive: true, force: true });
});

describe('importClaudeDesignZip', () => {
  it('imports nested utf-8 named files and picks root index.html', async () => {
    const { result, projectDir } = await runImport([
      { name: 'index.html', body: '<html>root</html>' },
      { name: 'volunteer/麓客志愿者系统.html', body: '<html>sub</html>' },
      { name: 'volunteer/vol.css', body: 'body{}' },
      { name: 'assets/', body: '' }, // 目录条目被忽略
    ]);
    expect(result.entryFile).toBe('index.html');
    expect(result.files.sort()).toEqual(['index.html', 'volunteer/vol.css', 'volunteer/麓客志愿者系统.html']);
    expect(fs.readFileSync(path.join(projectDir, 'volunteer/麓客志愿者系统.html'), 'utf8')).toBe('<html>sub</html>');
  });

  it('falls back to root-level html, then first html (subdir, 真实包形态)', async () => {
    const a = await runImport([
      { name: 'sub/x.html', body: '<p/>' },
      { name: 'main.html', body: '<p/>' },
    ]);
    expect(a.result.entryFile).toBe('main.html');
    const b = await runImport([
      { name: '.thumbnail', body: 'png' },
      { name: 'volunteer/麓客志愿者系统.html', body: '<p/>' },
      { name: 'volunteer/kit.css', body: '' },
    ]);
    expect(b.result.entryFile).toBe('volunteer/麓客志愿者系统.html');
  });

  it('rejects zips without html and empty zips', async () => {
    await expect(runImport([{ name: 'a.css', body: 'x' }])).rejects.toThrow('zip does not contain an HTML file');
    await expect(runImport([])).rejects.toThrow('zip contains no files');
  });

  it('rejects encrypted entries', async () => {
    await expect(runImport([{ name: 'index.html', body: '<p/>', flags: 1 }])).rejects.toThrow(
      'encrypted zip entries are not supported',
    );
  });

  it('rejects oversized entries via central directory size (early, pre-decode)', async () => {
    await expect(
      runImport([{ name: 'index.html', body: '<p/>', uncompressedSizeOverride: 26 * 1024 * 1024 }]),
    ).rejects.toThrow('zip file too large');
  });

  it('rejects traversal / absolute / reserved paths', async () => {
    await expect(runImport([{ name: '../evil.html', body: '<p/>' }])).rejects.toThrow('invalid file name');
    await expect(runImport([{ name: '/abs.html', body: '<p/>' }])).rejects.toThrow(
      'absolute zip paths are not allowed',
    );
    await expect(runImport([{ name: '.webui/meta.json', body: '{}' }])).rejects.toThrow('reserved project path');
  });

  it('decodes streaming entries whose central size reads 0', async () => {
    const { result, projectDir } = await runImport([
      { name: 'index.html', body: '<html>stream</html>', uncompressedSizeOverride: 0 },
    ]);
    expect(result.entryFile).toBe('index.html');
    expect(fs.readFileSync(path.join(projectDir, 'index.html'), 'utf8')).toBe('<html>stream</html>');
  });
});

describe('design-canvas.jsx normalization', () => {
  const wheelBlock = [
    '    // Mouse-wheel vs trackpad-scroll heuristic.',
    '    const onWheel = (e) => {',
    '      zoomAt(e.clientX, e.clientY, 1);',
    '    };',
    '',
  ].join('\n');
  const gestureBlock = [
    '    // Safari sends native gesture* events for trackpad pinch with a smooth',
    '    // momentum curve.',
    '    const onGestureEnd = (e) => { e.preventDefault(); isGesturing = false; };',
  ].join('\n');

  it('rewrites matching wheel/gesture handlers without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = `function Canvas() {\n${wheelBlock}${gestureBlock}\n}\n`;
    const { projectDir } = await runImport([
      { name: 'index.html', body: '<p/>' },
      { name: 'design-canvas.jsx', body: source },
    ]);
    const out = fs.readFileSync(path.join(projectDir, 'design-canvas.jsx'), 'utf8');
    expect(out).toContain('panByWheel');
    expect(out).not.toContain('Mouse-wheel vs trackpad-scroll heuristic');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns and keeps source when handlers do not match the template', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = 'export const nothingToRewrite = true;\n';
    const { projectDir } = await runImport([
      { name: 'index.html', body: '<p/>' },
      { name: 'design-canvas.jsx', body: source },
    ]);
    expect(fs.readFileSync(path.join(projectDir, 'design-canvas.jsx'), 'utf8')).toBe(source);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[claude-design-import]'));
    warn.mockRestore();
  });
});
