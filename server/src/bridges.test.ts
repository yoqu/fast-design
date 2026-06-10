import { describe, expect, it } from 'vitest';
import { injectSnapshotBridge, wantsSnapshotBridge } from './bridges.js';

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
