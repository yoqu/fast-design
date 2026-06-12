/* 桌面浏览器窗口铬（红绿灯 / 地址栏）。内容自适应宽度。 */
function BrowserWindow({ children, url = 'example.com', label }) {
  const browserStyles = {
    host: { width: '100%', display: 'grid', gap: 8 },
    window: {
      borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)',
      background: 'var(--surface)', boxShadow: 'var(--shadow)',
    },
    chrome: {
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
      borderBottom: '1px solid var(--border)', background: 'var(--bg)',
    },
    lights: { display: 'flex', gap: 7 },
    light: (c) => ({ width: 12, height: 12, borderRadius: '50%', background: c }),
    address: {
      flex: 1, maxWidth: 480, margin: '0 auto', padding: '5px 14px', borderRadius: 8,
      background: 'var(--surface)', border: '1px solid var(--border)',
      color: 'var(--muted)', fontSize: 13, textAlign: 'center',
      fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden',
    },
    body: { minHeight: 360, background: 'var(--bg)' },
  };
  return (
    <figure style={browserStyles.host}>
      <div style={browserStyles.window}>
        <div style={browserStyles.chrome}>
          <div style={browserStyles.lights}>
            <span style={browserStyles.light('#ff5f57')} />
            <span style={browserStyles.light('#febc2e')} />
            <span style={browserStyles.light('#28c840')} />
          </div>
          <div style={browserStyles.address}>{url}</div>
          <div style={{ width: 54 }} />
        </div>
        <div style={browserStyles.body}>{children}</div>
      </div>
      {label ? <figcaption style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</figcaption> : null}
    </figure>
  );
}

Object.assign(window, { BrowserWindow });
