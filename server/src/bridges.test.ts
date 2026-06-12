import { describe, expect, it } from 'vitest';
import {
  injectSnapshotBridge,
  injectTextEditBridge,
  wantsSnapshotBridge,
  wantsTextEditBridge,
} from './bridges.js';

describe('wantsSnapshotBridge', () => {
  it('accepts snapshot/image/capture tokens in comma or space separated lists', () => {
    expect(wantsSnapshotBridge('snapshot')).toBe(true);
    expect(wantsSnapshotBridge('image')).toBe(true);
    expect(wantsSnapshotBridge('scroll,capture')).toBe(true);
    expect(wantsSnapshotBridge(['scroll', 'snapshot'])).toBe(true);
    expect(wantsSnapshotBridge('scroll')).toBe(false);
    expect(wantsSnapshotBridge(undefined)).toBe(false);
  });
});

describe('injectSnapshotBridge', () => {
  it('injects before </body> when present', () => {
    const html = '<html><body><h1>hi</h1></body></html>';
    const out = injectSnapshotBridge(html);
    expect(out).toContain('data-od-url-snapshot-bridge');
    expect(out.indexOf('data-od-url-snapshot-bridge')).toBeLessThan(out.indexOf('</body>'));
  });

  it('appends when no body close tag exists', () => {
    const out = injectSnapshotBridge('<h1>hi</h1>');
    expect(out.startsWith('<h1>hi</h1>')).toBe(true);
    expect(out).toContain('data-od-url-snapshot-bridge');
  });

  it('is idempotent', () => {
    const once = injectSnapshotBridge('<body></body>');
    const twice = injectSnapshotBridge(once);
    expect(twice).toBe(once);
  });
});

describe('wantsTextEditBridge', () => {
  it('accepts edit/text-edit/text tokens in comma or space separated lists', () => {
    expect(wantsTextEditBridge('edit')).toBe(true);
    expect(wantsTextEditBridge('text-edit')).toBe(true);
    expect(wantsTextEditBridge('snapshot,edit')).toBe(true);
    expect(wantsTextEditBridge(['snapshot', 'text'])).toBe(true);
    expect(wantsTextEditBridge('snapshot')).toBe(false);
    expect(wantsTextEditBridge(undefined)).toBe(false);
  });
});

describe('injectTextEditBridge', () => {
  it('injects before </body> when present', () => {
    const out = injectTextEditBridge('<html><body><h1>hi</h1></body></html>');
    expect(out).toContain('data-pi-text-edit-bridge');
    expect(out.indexOf('data-pi-text-edit-bridge')).toBeLessThan(out.indexOf('</body>'));
  });

  it('is idempotent and coexists with the snapshot bridge', () => {
    const once = injectTextEditBridge(injectSnapshotBridge('<body></body>'));
    expect(injectTextEditBridge(once)).toBe(once);
    expect(once).toContain('data-od-url-snapshot-bridge');
    expect(once).toContain('data-pi-text-edit-bridge');
  });

  it('ships the Babel pi-loc instrumentation (spec 附录 B)', () => {
    const out = injectTextEditBridge('<body></body>');
    // registerPlugin + data-plugins 补丁（必须保留 standalone 默认插件三件套，
    // data-plugins 会整体覆盖默认值）。
    expect(out).toContain("registerPlugin('pi-loc'");
    expect(out).toContain('data-pi-loc');
    expect(out).toContain('transform-class-properties,transform-object-rest-spread,transform-flow-strip-types');
    // 提交协议携带 loc。
    expect(out).toMatch(/loc/);
  });
});
