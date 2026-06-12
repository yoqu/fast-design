/* iPhone 外框（Dynamic Island / 状态栏 / Home indicator）。
   内容逻辑尺寸 393×852，外框 transform:scale() 自适应。 */
const { useState: useStateIos, useEffect: useEffectIos, useRef: useRefIos } = React;

function IosFrame({ children, label, time = '9:41' }) {
  const W = 393, H = 852, BEZEL = 12;
  const hostRef = useRefIos(null);
  const [scale, setScale] = useStateIos(1);
  useEffectIos(() => {
    const fit = () => {
      const el = hostRef.current;
      if (el) setScale(Math.min(1, el.clientWidth / (W + BEZEL * 2)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  const iosStyles = {
    host: { width: '100%', display: 'grid', justifyItems: 'center', gap: 8 },
    device: {
      width: W + BEZEL * 2, height: H + BEZEL * 2, borderRadius: 56, background: '#0c0c0e',
      boxShadow: 'var(--shadow)', transform: `scale(${scale})`, transformOrigin: 'top center',
    },
    screen: {
      position: 'relative', width: W, height: H, margin: BEZEL, borderRadius: 46,
      overflow: 'hidden', background: 'var(--bg)',
    },
    statusBar: {
      position: 'absolute', top: 0, left: 0, right: 0, height: 54, zIndex: 50,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '0 28px', fontSize: 15, fontWeight: 600, color: 'var(--fg)', pointerEvents: 'none',
    },
    island: {
      position: 'absolute', top: 11, left: '50%', transform: 'translateX(-50%)',
      width: 122, height: 36, borderRadius: 20, background: '#000', zIndex: 60,
    },
    content: { position: 'absolute', inset: 0, paddingTop: 54, paddingBottom: 34, overflowY: 'auto' },
    homeBar: {
      position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
      width: 140, height: 5, borderRadius: 3, background: 'var(--fg)', opacity: 0.9, zIndex: 50,
    },
  };
  return (
    <figure ref={hostRef} style={iosStyles.host}>
      <div style={iosStyles.device}>
        <div style={iosStyles.screen}>
          <div style={iosStyles.island} />
          <div style={iosStyles.statusBar}>
            <span>{time}</span>
            <svg width="62" height="14" viewBox="0 0 62 14" aria-hidden="true">
              <rect x="0" y="3" width="3" height="8" rx="1" fill="currentColor" />
              <rect x="5" y="2" width="3" height="9" rx="1" fill="currentColor" />
              <rect x="10" y="1" width="3" height="10" rx="1" fill="currentColor" />
              <rect x="15" y="0" width="3" height="11" rx="1" fill="currentColor" />
              <path d="M26 4c2.8-2.7 7.2-2.7 10 0l-1.6 1.7a5.6 5.6 0 0 0-6.8 0L26 4z" fill="currentColor" />
              <rect x="42" y="1" width="18" height="11" rx="3" fill="none" stroke="currentColor" />
              <rect x="44" y="3" width="11" height="7" rx="1.5" fill="currentColor" />
              <rect x="60.5" y="4.5" width="1.5" height="4" rx="0.7" fill="currentColor" />
            </svg>
          </div>
          <div style={iosStyles.content}>{children}</div>
          <div style={iosStyles.homeBar} />
        </div>
      </div>
      {label ? <figcaption style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</figcaption> : null}
    </figure>
  );
}

Object.assign(window, { IosFrame });
