/* Pixel 外框（打孔摄像头 / 状态栏 / 手势条）。逻辑尺寸 412×915。 */
const { useState: useStateAnd, useEffect: useEffectAnd, useRef: useRefAnd } = React;

function AndroidFrame({ children, label, time = '10:08' }) {
  const W = 412, H = 915, BEZEL = 10;
  const hostRef = useRefAnd(null);
  const [scale, setScale] = useStateAnd(1);
  useEffectAnd(() => {
    const fit = () => {
      const el = hostRef.current;
      if (el) setScale(Math.min(1, el.clientWidth / (W + BEZEL * 2)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  const androidStyles = {
    host: { width: '100%', display: 'grid', justifyItems: 'center', gap: 8 },
    device: {
      width: W + BEZEL * 2, height: H + BEZEL * 2, borderRadius: 36, background: '#101013',
      boxShadow: 'var(--shadow)', transform: `scale(${scale})`, transformOrigin: 'top center',
    },
    screen: {
      position: 'relative', width: W, height: H, margin: BEZEL, borderRadius: 28,
      overflow: 'hidden', background: 'var(--bg)',
    },
    camera: {
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
      width: 12, height: 12, borderRadius: '50%', background: '#000', zIndex: 60,
    },
    statusBar: {
      position: 'absolute', top: 0, left: 0, right: 0, height: 40, zIndex: 50,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '0 18px', fontSize: 14, fontWeight: 500, color: 'var(--fg)', pointerEvents: 'none',
    },
    content: { position: 'absolute', inset: 0, paddingTop: 40, paddingBottom: 28, overflowY: 'auto' },
    gestureBar: {
      position: 'absolute', bottom: 9, left: '50%', transform: 'translateX(-50%)',
      width: 108, height: 4, borderRadius: 2, background: 'var(--fg)', opacity: 0.85, zIndex: 50,
    },
  };
  return (
    <figure ref={hostRef} style={androidStyles.host}>
      <div style={androidStyles.device}>
        <div style={androidStyles.screen}>
          <div style={androidStyles.camera} />
          <div style={androidStyles.statusBar}>
            <span>{time}</span>
            <svg width="50" height="14" viewBox="0 0 50 14" aria-hidden="true">
              <path d="M1 13 L11 13 L11 1 Z" fill="currentColor" />
              <path d="M16 6c2.4-2.3 6.2-2.3 8.6 0l-1.4 1.5a4.8 4.8 0 0 0-5.8 0L16 6z" fill="currentColor" />
              <rect x="30" y="2" width="7" height="11" rx="1.5" fill="none" stroke="currentColor" />
              <rect x="31.5" y="6" width="4" height="6" fill="currentColor" />
            </svg>
          </div>
          <div style={androidStyles.content}>{children}</div>
          <div style={androidStyles.gestureBar} />
        </div>
      </div>
      {label ? <figcaption style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</figcaption> : null}
    </figure>
  );
}

Object.assign(window, { AndroidFrame });
