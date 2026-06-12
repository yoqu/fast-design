/* 动效原语 — Stage / Sprite / useTime / useSprite / Easing / interpolate
   用法：<Stage duration={6}><Sprite start={0} end={2}>…</Sprite></Stage>
   消费方从 window 读取。仅 transform/opacity 动画。 */
const { useState, useEffect, useRef, useContext, createContext } = React;

const TimeContext = createContext({ t: 0, duration: 0, playing: false });

function useTime() { return useContext(TimeContext); }

const Easing = {
  linear: (x) => x,
  easeIn: (x) => x * x,
  easeOut: (x) => 1 - (1 - x) * (1 - x),
  easeInOut: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  spring: (x) => 1 - Math.cos(x * Math.PI * 2.5) * Math.exp(-x * 5),
};

function interpolate(t, [t0, t1], [v0, v1], ease = Easing.linear) {
  if (t1 === t0) return v1;
  const p = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return v0 + (v1 - v0) * ease(p);
}

/** 固定逻辑画布 + scale-to-fit + 播放/暂停 + 拖动条。 */
function Stage({ width = 1280, height = 720, duration = 8, loop = true, children, style }) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [scale, setScale] = useState(1);
  const hostRef = useRef(null);
  const raf = useRef(0);
  const last = useRef(0);

  useEffect(() => {
    const fit = () => {
      const el = hostRef.current;
      if (el) setScale(Math.min(el.clientWidth / width, el.clientHeight / height));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [width, height]);

  useEffect(() => {
    if (!playing) return undefined;
    const tick = (now) => {
      if (!last.current) last.current = now;
      const dt = (now - last.current) / 1000;
      last.current = now;
      setT((prev) => {
        const next = prev + dt;
        return next > duration ? (loop ? next % duration : duration) : next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf.current); last.current = 0; };
  }, [playing, duration, loop]);

  const stageStyles = {
    host: { position: 'relative', width: '100%', height: '100%', minHeight: 320, overflow: 'hidden', ...style },
    canvas: { position: 'absolute', left: '50%', top: '50%', width, height, transform: `translate(-50%, -50%) scale(${scale})` },
    bar: { position: 'absolute', left: 12, right: 12, bottom: 10, display: 'flex', gap: 8, alignItems: 'center', opacity: 0.85 },
  };
  return (
    <TimeContext.Provider value={{ t, duration, playing }}>
      <div ref={hostRef} style={stageStyles.host}>
        <div style={stageStyles.canvas}>{children}</div>
        <div style={stageStyles.bar}>
          <button type="button" aria-label={playing ? '暂停' : '播放'} onClick={() => setPlaying((p) => !p)}
            style={{ minWidth: 44, minHeight: 44, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
            {playing ? '⏸' : '▶'}
          </button>
          <input type="range" min={0} max={duration} step={0.01} value={t} aria-label="时间轴"
            onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} style={{ flex: 1 }} />
        </div>
      </div>
    </TimeContext.Provider>
  );
}

/** 帧范围内渲染子节点；progress 0→1。enter/exit 用 opacity+transform。 */
function Sprite({ start = 0, end = Infinity, fade = 0.25, children, style }) {
  const { t } = useTime();
  if (t < start || t >= end) return null;
  const fin = interpolate(t, [start, start + fade], [0, 1], Easing.easeOut);
  const fout = end === Infinity ? 1 : interpolate(t, [end - fade, end], [1, 0], Easing.easeIn);
  const opacity = Math.min(fin, fout);
  return <div style={{ opacity, transform: `translateY(${(1 - opacity) * 8}px)`, ...style }}>{children}</div>;
}

function useSprite(start, end) {
  const { t } = useTime();
  const active = t >= start && t < end;
  const progress = interpolate(t, [start, end], [0, 1]);
  return { active, progress, t };
}

Object.assign(window, { Stage, Sprite, useTime, useSprite, Easing, interpolate });
