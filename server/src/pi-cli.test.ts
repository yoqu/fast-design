import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type PiRunner,
  getPiStatus,
  installExtension,
  listExtensions,
  listModels,
  removeExtension,
  validateExtensionSource,
} from './pi-cli.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-cli-test-'));
  process.env.PI_WEBUI_PI_DIR = dir;
});

afterEach(() => {
  delete process.env.PI_WEBUI_PI_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

const ok = (stdout: string, stderr = ''): ReturnType<PiRunner> =>
  Promise.resolve({ code: 0, stdout, stderr });

describe('getPiStatus', () => {
  it('reports installed with version', async () => {
    const runner: PiRunner = () => ok('0.78.0\n');
    expect(await getPiStatus(runner)).toEqual({ installed: true, version: '0.78.0', piDir: dir });
  });

  it('reports not installed on ENOENT', async () => {
    const runner: PiRunner = () => Promise.reject(Object.assign(new Error('nope'), { code: 'ENOENT' }));
    expect(await getPiStatus(runner)).toEqual({ installed: false, version: null, piDir: dir });
  });
});

describe('listModels', () => {
  it('parses the table from stderr, skipping the header', async () => {
    const table = [
      'provider    model                   context  max-out  thinking  images',
      'minimax-cn  MiniMax-M2.7            204.8K   131.1K   yes       no',
      'minimax-cn  MiniMax-M2.7-highspeed  204.8K   131.1K   yes       no',
      '',
    ].join('\n');
    const runner: PiRunner = () => ok('', table);
    expect(await listModels(runner)).toEqual([
      { provider: 'minimax-cn', id: 'MiniMax-M2.7' },
      { provider: 'minimax-cn', id: 'MiniMax-M2.7-highspeed' },
    ]);
  });
});

describe('extensions', () => {
  it('lists packages from settings.json (string and object form)', () => {
    fs.writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({ packages: ['pi-skills', { source: 'git:github.com/u/repo', skills: [] }] }),
    );
    expect(listExtensions()).toEqual([{ source: 'pi-skills' }, { source: 'git:github.com/u/repo' }]);
  });

  it('validates sources', () => {
    expect(validateExtensionSource('pi-skills')).toBe(true);
    expect(validateExtensionSource('@org/pkg')).toBe(true);
    expect(validateExtensionSource('git:github.com/u/repo@v1')).toBe(true);
    expect(validateExtensionSource('pkg; rm -rf /')).toBe(false);
    expect(validateExtensionSource('a b')).toBe(false);
    expect(validateExtensionSource('')).toBe(false);
  });

  it('install/remove run pi with argv and serialize concurrent installs', async () => {
    const calls: string[][] = [];
    const runner: PiRunner = (args) => {
      calls.push(args);
      return ok('installed\n');
    };
    const r = await installExtension('pi-skills', runner);
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual(['install', 'pi-skills']);
    await removeExtension('pi-skills', runner);
    expect(calls[1]).toEqual(['remove', 'pi-skills']);
    await expect(installExtension('bad source!', runner)).rejects.toThrow(/BAD_SOURCE/);
  });

  it('reports failure output when pi exits non-zero', async () => {
    const runner: PiRunner = () => Promise.resolve({ code: 1, stdout: '', stderr: 'not found' });
    const r = await installExtension('nope-pkg', runner);
    expect(r.ok).toBe(false);
    expect(r.output).toContain('not found');
  });
});
