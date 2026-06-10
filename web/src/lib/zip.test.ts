import { describe, expect, it } from 'vitest';
import { buildZip } from './zip';

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function readU32(arr: Uint8Array, offset: number): number {
  return new DataView(arr.buffer, arr.byteOffset).getUint32(offset, true);
}

describe('buildZip', () => {
  it('produces a stored-mode zip with local header signature', async () => {
    const out = await bytes(buildZip([{ path: 'a/index.html', content: '<h1>hi</h1>' }]));
    expect(readU32(out, 0)).toBe(0x04034b50);
    expect(out.length).toBeGreaterThan(30);
  });

  it('writes an end-of-central-directory record with the entry count', async () => {
    const entries = [
      { path: 'p/index.html', content: '<h1></h1>' },
      { path: 'p/DESIGN-HANDOFF.md', content: '# handoff' },
      { path: 'p/DESIGN-MANIFEST.json', content: '{}' },
    ];
    const out = await bytes(buildZip(entries));
    // EOCD is the last 22 bytes (no comment).
    const eocd = out.length - 22;
    expect(readU32(out, eocd)).toBe(0x06054b50);
    const view = new DataView(out.buffer, out.byteOffset);
    expect(view.getUint16(eocd + 10, true)).toBe(3);
  });

  it('stores utf-8 content verbatim (no compression)', async () => {
    const content = '你好,原型';
    const out = await bytes(buildZip([{ path: 'x.txt', content }]));
    const text = new TextDecoder().decode(out);
    expect(text).toContain(content);
  });
});
