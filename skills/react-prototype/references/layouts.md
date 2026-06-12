# react-prototype 屏幕骨架库

paste-ready React 骨架。直接拷进 `<script type="text/babel" data-presets="react">` 或
`.jsx` 组件文件（末尾自带 `Object.assign(window, {...})`）。约定：受控 `useState` +
校验 + `localStorage` 持久；颜色只用 `var(--token)`（状态色可用 `oklch()` 字面量）；
样式对象按组件命名；触控目标 ≥ 44px；不使用 `scrollIntoView`。

---

### 骨架 1：预约/结算分步流

- 适用：预约、下单结算、注册向导等多步表单。
- 状态：`step` + `form` 草稿写 `localStorage`，刷新续上；每步前进先校验本步。
- 交互注记：步骤指示可点已完成步回退；字段失焦/提交触发错误；末步显示确认态。

```jsx
const { useState: useStateBk, useEffect: useEffectBk } = React;
const BK_STEPS = ['联系人', '时间', '确认'];

function BookingFlow() {
  const [step, setStep] = useStateBk(() => Number(localStorage.getItem('bk:step') || 0));
  const [form, setForm] = useStateBk(() => {
    try { return JSON.parse(localStorage.getItem('bk:form')) || {}; } catch { return {}; }
  });
  const [errors, setErrors] = useStateBk({});
  const [done, setDone] = useStateBk(false);
  useEffectBk(() => { localStorage.setItem('bk:step', String(step)); }, [step]);
  useEffectBk(() => { localStorage.setItem('bk:form', JSON.stringify(form)); }, [form]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const validate = (s) => {
    const e = {};
    if (s === 0) {
      if (!form.name) e.name = '请填写姓名';
      if (!/^1\d{10}$/.test(form.phone || '')) e.phone = '手机号格式不正确';
    }
    if (s === 1 && !form.date) e.date = '请选择日期';
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const next = () => { if (validate(step)) setStep((s) => Math.min(s + 1, BK_STEPS.length - 1)); };
  const submit = () => { if (validate(1)) { setDone(true); localStorage.removeItem('bk:step'); } };

  const bookingStyles = {
    wrap: { maxWidth: 440, margin: '0 auto', padding: 24, display: 'grid', gap: 16 },
    steps: { display: 'flex', gap: 8 },
    dot: (on) => ({ flex: 1, height: 6, borderRadius: 3, background: on ? 'var(--accent)' : 'var(--border)', cursor: 'pointer' }),
    field: { display: 'grid', gap: 6 },
    input: { minHeight: 44, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontSize: 16 },
    err: { color: 'oklch(58% 0.18 25)', fontSize: 13 },
    btn: { minHeight: 44, borderRadius: 'var(--radius)', border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 16, fontWeight: 600, cursor: 'pointer' },
  };
  if (done) return <div style={bookingStyles.wrap}><h2 style={{ fontFamily: 'var(--font-display)' }}>预约成功</h2><p style={{ color: 'var(--muted)' }}>{form.name} · {form.date}，我们会短信通知 {form.phone}。</p></div>;
  return (
    <div style={bookingStyles.wrap}>
      <div style={bookingStyles.steps}>{BK_STEPS.map((label, i) => <div key={label} title={label} onClick={() => i <= step && setStep(i)} style={bookingStyles.dot(i <= step)} />)}</div>
      <h2 style={{ fontFamily: 'var(--font-display)', margin: 0 }}>{BK_STEPS[step]}</h2>
      {step === 0 && <>
        <label style={bookingStyles.field}>姓名<input style={bookingStyles.input} value={form.name || ''} onChange={set('name')} onBlur={() => validate(0)} />{errors.name && <span style={bookingStyles.err}>{errors.name}</span>}</label>
        <label style={bookingStyles.field}>手机号<input style={bookingStyles.input} inputMode="numeric" value={form.phone || ''} onChange={set('phone')} onBlur={() => validate(0)} />{errors.phone && <span style={bookingStyles.err}>{errors.phone}</span>}</label>
      </>}
      {step === 1 && <label style={bookingStyles.field}>预约日期<input type="date" style={bookingStyles.input} value={form.date || ''} onChange={set('date')} />{errors.date && <span style={bookingStyles.err}>{errors.date}</span>}</label>}
      {step === 2 && <ul style={{ color: 'var(--muted)', lineHeight: 1.9 }}><li>姓名：{form.name}</li><li>手机：{form.phone}</li><li>日期：{form.date}</li></ul>}
      <button type="button" style={bookingStyles.btn} onClick={step === 2 ? submit : next}>{step === 2 ? '确认预约' : '下一步'}</button>
    </div>
  );
}

Object.assign(window, { BookingFlow });
```

---

### 骨架 2：Feed → 详情

- 适用：内容流、商品列表、收件箱等"列表选中看详情"模式。
- 状态：`query`/`tag` 受控筛选；`selectedId` 控制详情条件渲染；返回时列表滚动位经 `ref` 保留。
- 交互注记：搜索框实时过滤；标签单选；点条目进详情、返回不丢列表位置（不用 scrollIntoView）。

```jsx
const { useState: useStateFd, useRef: useRefFd } = React;
const FD_ITEMS = [
  { id: 1, tag: '设计', title: '配色系统重构', body: '用 oklch 统一明暗两套主题，降低跨屏色彩漂移。' },
  { id: 2, tag: '工程', title: '预览管线提速', body: '增量编译 + 资产缓存，热更新从 1.2s 降到 200ms。' },
  { id: 3, tag: '设计', title: '动效原语收敛', body: 'Stage/Sprite 两个原语覆盖 80% 入场动画需求。' },
  { id: 4, tag: '工程', title: '骨架库扩充', body: '六个 paste-ready 骨架进入内置 skill。' },
];
const FD_TAGS = ['全部', '设计', '工程'];

function FeedToDetail() {
  const [query, setQuery] = useStateFd('');
  const [tag, setTag] = useStateFd('全部');
  const [selectedId, setSelectedId] = useStateFd(null);
  const listRef = useRefFd(null);
  const scrollTop = useRefFd(0);

  const shown = FD_ITEMS.filter((it) =>
    (tag === '全部' || it.tag === tag) &&
    (it.title + it.body).toLowerCase().includes(query.toLowerCase()));
  const open = (id) => { if (listRef.current) scrollTop.current = listRef.current.scrollTop; setSelectedId(id); };
  const back = () => { setSelectedId(null); requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = scrollTop.current; }); };
  const detail = FD_ITEMS.find((it) => it.id === selectedId);

  const feedStyles = {
    wrap: { maxWidth: 480, margin: '0 auto', height: 560, display: 'flex', flexDirection: 'column', gap: 12, padding: 16 },
    search: { minHeight: 44, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontSize: 16 },
    tags: { display: 'flex', gap: 8 },
    chip: (on) => ({ minHeight: 36, padding: '0 14px', borderRadius: 18, border: '1px solid var(--border)', background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--accent-fg)' : 'var(--fg)', cursor: 'pointer' }),
    list: { overflowY: 'auto', display: 'grid', gap: 10, flex: 1 },
    card: { textAlign: 'left', padding: 14, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', cursor: 'pointer' },
    meta: { color: 'var(--muted)', fontSize: 13 },
    back: { minHeight: 44, alignSelf: 'start', padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', cursor: 'pointer' },
  };
  if (detail) return (
    <div style={feedStyles.wrap}>
      <button type="button" style={feedStyles.back} onClick={back}>← 返回</button>
      <span style={feedStyles.meta}>{detail.tag}</span>
      <h2 style={{ fontFamily: 'var(--font-display)', margin: 0 }}>{detail.title}</h2>
      <p style={{ color: 'var(--muted)', lineHeight: 1.7 }}>{detail.body}</p>
    </div>
  );
  return (
    <div style={feedStyles.wrap}>
      <input style={feedStyles.search} placeholder="搜索…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div style={feedStyles.tags}>{FD_TAGS.map((t) => <button key={t} type="button" style={feedStyles.chip(t === tag)} onClick={() => setTag(t)}>{t}</button>)}</div>
      <div ref={listRef} style={feedStyles.list}>
        {shown.length === 0 && <p style={feedStyles.meta}>无匹配结果。</p>}
        {shown.map((it) => <button key={it.id} type="button" style={feedStyles.card} onClick={() => open(it.id)}><div style={feedStyles.meta}>{it.tag}</div><strong>{it.title}</strong></button>)}
      </div>
    </div>
  );
}

Object.assign(window, { FeedToDetail });
```

---

### 骨架 3：仪表盘

- 适用：分析后台、运营概览。指标卡 + 明细表 + 时间范围切换。
- 状态：`range` 受控切换驱动指标与表格重算；列点击切换排序。
- 交互注记：时间范围按钮联动数字（确定性派生，非编造）；表头点击升降序；数字用 monospace。

```jsx
const { useState: useStateDb, useMemo: useMemoDb } = React;
const DB_RANGES = { '7天': 7, '30天': 30, '90天': 90 };
const DB_ROWS = [
  { name: '自然搜索', base: 1280, rate: 0.042 },
  { name: '社媒投放', base: 940, rate: 0.031 },
  { name: '邮件触达', base: 610, rate: 0.058 },
  { name: '直接访问', base: 1520, rate: 0.025 },
];

function Dashboard() {
  const [range, setRange] = useStateDb('30天');
  const [sort, setSort] = useStateDb({ key: 'visits', dir: 'desc' });
  const days = DB_RANGES[range];
  const rows = useMemoDb(() => DB_ROWS.map((r) => {
    const visits = Math.round(r.base * (days / 30));
    const conv = Math.round(visits * r.rate);
    return { name: r.name, visits, conv, rate: (r.rate * 100).toFixed(1) };
  }), [days]);
  const sorted = [...rows].sort((a, b) => {
    const dir = sort.dir === 'desc' ? -1 : 1;
    return sort.key === 'name' ? dir * a.name.localeCompare(b.name) : dir * (a[sort.key] - b[sort.key]);
  });
  const totalVisits = rows.reduce((s, r) => s + r.visits, 0);
  const totalConv = rows.reduce((s, r) => s + r.conv, 0);
  const toggle = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  const dashStyles = {
    wrap: { maxWidth: 760, margin: '0 auto', padding: 24, display: 'grid', gap: 16 },
    bar: { display: 'flex', gap: 8 },
    rng: (on) => ({ minHeight: 40, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--accent-fg)' : 'var(--fg)', cursor: 'pointer' }),
    cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 },
    card: { padding: 16, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)' },
    num: { fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700 },
    label: { color: 'var(--muted)', fontSize: 13 },
    table: { width: '100%', borderCollapse: 'collapse', background: 'var(--surface)', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' },
    th: { textAlign: 'right', padding: 12, cursor: 'pointer', color: 'var(--muted)', fontSize: 13, borderBottom: '1px solid var(--border)' },
    td: { textAlign: 'right', padding: 12, fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border)' },
  };
  const arrow = (k) => sort.key === k ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '';
  return (
    <div style={dashStyles.wrap}>
      <div style={dashStyles.bar}>{Object.keys(DB_RANGES).map((r) => <button key={r} type="button" style={dashStyles.rng(r === range)} onClick={() => setRange(r)}>{r}</button>)}</div>
      <div style={dashStyles.cards}>
        <div style={dashStyles.card}><div style={dashStyles.label}>访问量</div><div style={dashStyles.num}>{totalVisits.toLocaleString()}</div></div>
        <div style={dashStyles.card}><div style={dashStyles.label}>转化数</div><div style={dashStyles.num}>{totalConv.toLocaleString()}</div></div>
        <div style={dashStyles.card}><div style={dashStyles.label}>转化率</div><div style={dashStyles.num}>{(totalConv / totalVisits * 100).toFixed(1)}%</div></div>
      </div>
      <table style={dashStyles.table}>
        <thead><tr>
          <th style={{ ...dashStyles.th, textAlign: 'left' }} onClick={() => toggle('name')}>渠道{arrow('name')}</th>
          <th style={dashStyles.th} onClick={() => toggle('visits')}>访问{arrow('visits')}</th>
          <th style={dashStyles.th} onClick={() => toggle('conv')}>转化{arrow('conv')}</th>
          <th style={dashStyles.th} onClick={() => toggle('rate')}>率%{arrow('rate')}</th>
        </tr></thead>
        <tbody>{sorted.map((r) => <tr key={r.name}>
          <td style={{ ...dashStyles.td, textAlign: 'left', fontFamily: 'var(--font-body)' }}>{r.name}</td>
          <td style={dashStyles.td}>{r.visits.toLocaleString()}</td>
          <td style={dashStyles.td}>{r.conv}</td>
          <td style={dashStyles.td}>{r.rate}</td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}

Object.assign(window, { Dashboard });
```

---

### 骨架 4：Onboarding 序列

- 适用：首次启动引导、功能介绍 3 屏轮播。
- 状态：`index` 受控翻页；完成态写 `localStorage('ob:done')`，已完成则直接显示主界面。
- 交互注记：下一步/跳过；圆点指示可点跳转；最后一屏按钮变"开始使用"，点完落库。

```jsx
const { useState: useStateOb, useEffect: useEffectOb } = React;
const OB_SLIDES = [
  { icon: '✦', title: '统一设计语言', desc: 'oklch token 驱动明暗双主题，跨屏一致。' },
  { icon: '⚡', title: '真实交互原型', desc: '受控组件 + 校验 + 持久状态，不止截图。' },
  { icon: '◐', title: '一键设备框架', desc: 'iOS / Android / 浏览器框，随手套用。' },
];

function Onboarding() {
  const [done, setDone] = useStateOb(() => localStorage.getItem('ob:done') === '1');
  const [index, setIndex] = useStateOb(0);
  useEffectOb(() => { localStorage.setItem('ob:done', done ? '1' : '0'); }, [done]);
  const last = index === OB_SLIDES.length - 1;
  const finish = () => setDone(true);
  const reset = () => { setDone(false); setIndex(0); };

  const obStyles = {
    wrap: { maxWidth: 360, margin: '0 auto', minHeight: 520, padding: 28, display: 'flex', flexDirection: 'column', gap: 20 },
    skip: { alignSelf: 'flex-end', minHeight: 44, padding: '0 8px', border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 15 },
    hero: { flex: 1, display: 'grid', placeContent: 'center', textAlign: 'center', gap: 12 },
    icon: { fontSize: 56, color: 'var(--accent)' },
    dots: { display: 'flex', gap: 8, justifyContent: 'center' },
    dot: (on) => ({ width: on ? 22 : 8, height: 8, borderRadius: 4, border: 'none', padding: 0, background: on ? 'var(--accent)' : 'var(--border)', cursor: 'pointer', transition: 'width .2s' }),
    btn: { minHeight: 48, borderRadius: 'var(--radius)', border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 16, fontWeight: 600, cursor: 'pointer' },
    link: { minHeight: 44, border: 'none', background: 'transparent', color: 'var(--accent)', cursor: 'pointer' },
  };
  if (done) return <div style={obStyles.wrap}><div style={obStyles.hero}><h2 style={{ fontFamily: 'var(--font-display)' }}>欢迎回来 👋</h2><p style={{ color: 'var(--muted)' }}>这里是你的主界面。</p></div><button type="button" style={obStyles.link} onClick={reset}>重看引导</button></div>;
  const s = OB_SLIDES[index];
  return (
    <div style={obStyles.wrap}>
      <button type="button" style={obStyles.skip} onClick={finish}>跳过</button>
      <div style={obStyles.hero}>
        <div style={obStyles.icon} aria-hidden="true">{s.icon}</div>
        <h2 style={{ fontFamily: 'var(--font-display)', margin: 0 }}>{s.title}</h2>
        <p style={{ color: 'var(--muted)', lineHeight: 1.7 }}>{s.desc}</p>
      </div>
      <div style={obStyles.dots}>{OB_SLIDES.map((_, i) => <button key={i} type="button" aria-label={`第 ${i + 1} 屏`} style={obStyles.dot(i === index)} onClick={() => setIndex(i)} />)}</div>
      <button type="button" style={obStyles.btn} onClick={() => (last ? finish() : setIndex((i) => i + 1))}>{last ? '开始使用' : '下一步'}</button>
    </div>
  );
}

Object.assign(window, { Onboarding });
```

---

### 骨架 5：设置页

- 适用：账户/偏好设置，含开关、单选组与危险操作。
- 状态：所有项受控并即时写 `localStorage('settings')`，刷新保留；删除走确认对话框。
- 交互注记：Switch 真实切换；主题单选联动；删除弹确认框，Esc 关闭、确认才执行。

```jsx
const { useState: useStateSt, useEffect: useEffectSt } = React;
const ST_KEY = 'settings:v1';
const ST_DEFAULT = { notify: true, digest: false, theme: 'system' };

function SettingsPage() {
  const [cfg, setCfg] = useStateSt(() => {
    try { return { ...ST_DEFAULT, ...JSON.parse(localStorage.getItem(ST_KEY)) }; } catch { return ST_DEFAULT; }
  });
  const [confirming, setConfirming] = useStateSt(false);
  const [deleted, setDeleted] = useStateSt(false);
  useEffectSt(() => { localStorage.setItem(ST_KEY, JSON.stringify(cfg)); }, [cfg]);
  useEffectSt(() => {
    if (!confirming) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setConfirming(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming]);
  const toggle = (k) => setCfg((c) => ({ ...c, [k]: !c[k] }));

  const setStyles = {
    wrap: { maxWidth: 480, margin: '0 auto', padding: 24, display: 'grid', gap: 12 },
    row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, padding: '0 16px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)' },
    sw: (on) => ({ width: 52, height: 30, minHeight: 30, borderRadius: 15, border: 'none', background: on ? 'var(--accent)' : 'var(--border)', position: 'relative', cursor: 'pointer' }),
    knob: (on) => ({ position: 'absolute', top: 3, left: on ? 25 : 3, width: 24, height: 24, borderRadius: '50%', background: 'var(--surface)', transition: 'left .18s' }),
    seg: { display: 'flex', gap: 4, padding: 4, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)' },
    segBtn: (on) => ({ flex: 1, minHeight: 40, borderRadius: 8, border: 'none', background: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent-fg)' : 'var(--fg)', cursor: 'pointer' }),
    danger: { minHeight: 48, borderRadius: 'var(--radius)', border: '1px solid oklch(58% 0.18 25)', background: 'var(--surface)', color: 'oklch(55% 0.18 25)', cursor: 'pointer', fontWeight: 600 },
    overlay: { position: 'fixed', inset: 0, background: 'oklch(20% 0.02 250 / 0.45)', display: 'grid', placeItems: 'center', zIndex: 100 },
    dialog: { background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 24, maxWidth: 320, display: 'grid', gap: 16, boxShadow: 'var(--shadow)' },
  };
  if (deleted) return <div style={setStyles.wrap}><p style={{ color: 'var(--muted)' }}>账户已删除。</p></div>;
  return (
    <div style={setStyles.wrap}>
      <div style={setStyles.row}><span>推送通知</span><button type="button" aria-pressed={cfg.notify} style={setStyles.sw(cfg.notify)} onClick={() => toggle('notify')}><span style={setStyles.knob(cfg.notify)} /></button></div>
      <div style={setStyles.row}><span>每周摘要邮件</span><button type="button" aria-pressed={cfg.digest} style={setStyles.sw(cfg.digest)} onClick={() => toggle('digest')}><span style={setStyles.knob(cfg.digest)} /></button></div>
      <div style={setStyles.seg}>{['light', 'dark', 'system'].map((t) => <button key={t} type="button" style={setStyles.segBtn(cfg.theme === t)} onClick={() => setCfg((c) => ({ ...c, theme: t }))}>{{ light: '浅色', dark: '深色', system: '跟随系统' }[t]}</button>)}</div>
      <button type="button" style={setStyles.danger} onClick={() => setConfirming(true)}>删除账户</button>
      {confirming && (
        <div style={setStyles.overlay} onClick={() => setConfirming(false)}>
          <div style={setStyles.dialog} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <strong style={{ fontFamily: 'var(--font-display)' }}>确认删除账户？</strong>
            <p style={{ color: 'var(--muted)', margin: 0 }}>此操作不可撤销。</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={{ ...setStyles.segBtn(false), minHeight: 44, border: '1px solid var(--border)' }} onClick={() => setConfirming(false)}>取消</button>
              <button type="button" style={{ ...setStyles.danger, flex: 1 }} onClick={() => { setDeleted(true); setConfirming(false); }}>确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { SettingsPage });
```

---

### 骨架 6：营销落地页 hero + 定价

- 适用：产品官网首屏 + 定价区 + 邮箱订阅 CTA。
- 状态：`billing` 月/年切换联动价格；邮箱受控 + 校验 + 提交成功态（无后端，仅前端反馈）。
- 交互注记：年付显示折扣价；邮箱格式校验失败给红字；提交成功换成致谢文案。

```jsx
const { useState: useStateMk } = React;
const MK_PLANS = [
  { name: '入门', monthly: 0, features: ['1 个项目', '社区支持'] },
  { name: '专业', monthly: 19, features: ['无限项目', '设备框架', '邮件支持'], highlight: true },
  { name: '团队', monthly: 49, features: ['协作工作区', '审阅流', '优先支持'] },
];

function MarketingLanding() {
  const [billing, setBilling] = useStateMk('monthly');
  const [email, setEmail] = useStateMk('');
  const [error, setError] = useStateMk('');
  const [sent, setSent] = useStateMk(false);
  const price = (m) => billing === 'yearly' ? Math.round(m * 12 * 0.8) : m;
  const submit = (e) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError('请输入有效邮箱'); return; }
    setError(''); setSent(true);
  };

  const mkStyles = {
    wrap: { maxWidth: 920, margin: '0 auto', padding: 32, display: 'grid', gap: 32 },
    hero: { textAlign: 'center', display: 'grid', gap: 16, justifyItems: 'center' },
    h1: { fontFamily: 'var(--font-display)', fontSize: 40, margin: 0, lineHeight: 1.15, textWrap: 'balance' },
    sub: { color: 'var(--muted)', fontSize: 18, maxWidth: 520, textWrap: 'pretty' },
    form: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
    input: { minHeight: 48, minWidth: 240, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontSize: 16 },
    cta: { minHeight: 48, padding: '0 22px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontWeight: 600, cursor: 'pointer' },
    err: { color: 'oklch(58% 0.18 25)', fontSize: 13, width: '100%', textAlign: 'center' },
    toggle: { display: 'flex', gap: 4, padding: 4, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', justifySelf: 'center' },
    tBtn: (on) => ({ minHeight: 40, padding: '0 16px', borderRadius: 8, border: 'none', background: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent-fg)' : 'var(--fg)', cursor: 'pointer' }),
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 },
    card: (hl) => ({ padding: 24, borderRadius: 'var(--radius)', border: hl ? '2px solid var(--accent)' : '1px solid var(--border)', background: 'var(--surface)', display: 'grid', gap: 12 }),
    price: { fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 700 },
  };
  return (
    <div style={mkStyles.wrap}>
      <section style={mkStyles.hero}>
        <h1 style={mkStyles.h1}>把想法做成会动的原型</h1>
        <p style={mkStyles.sub}>React + Tailwind 固定栈，真实交互、设备框架、一键复用。开箱即用。</p>
        {sent ? <p style={{ color: 'var(--accent)' }}>已收到 {email}，上线时第一时间通知你 🎉</p> : (
          <form style={mkStyles.form} onSubmit={submit}>
            <input style={mkStyles.input} type="email" placeholder="你的邮箱" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" style={mkStyles.cta}>抢先体验</button>
            {error && <span style={mkStyles.err}>{error}</span>}
          </form>
        )}
      </section>
      <div style={mkStyles.toggle}>
        <button type="button" style={mkStyles.tBtn(billing === 'monthly')} onClick={() => setBilling('monthly')}>按月</button>
        <button type="button" style={mkStyles.tBtn(billing === 'yearly')} onClick={() => setBilling('yearly')}>按年 -20%</button>
      </div>
      <section style={mkStyles.grid}>
        {MK_PLANS.map((p) => (
          <div key={p.name} style={mkStyles.card(p.highlight)}>
            <strong style={{ fontFamily: 'var(--font-display)' }}>{p.name}</strong>
            <div style={mkStyles.price}>¥{price(p.monthly)}<span style={{ fontSize: 14, color: 'var(--muted)', fontFamily: 'var(--font-body)' }}>/{billing === 'yearly' ? '年' : '月'}</span></div>
            <ul style={{ color: 'var(--muted)', lineHeight: 1.9, margin: 0, paddingLeft: 18 }}>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
            <button type="button" style={{ ...mkStyles.cta, background: p.highlight ? 'var(--accent)' : 'var(--surface)', color: p.highlight ? 'var(--accent-fg)' : 'var(--fg)', border: p.highlight ? 'none' : '1px solid var(--border)' }}>选择 {p.name}</button>
          </div>
        ))}
      </section>
    </div>
  );
}

Object.assign(window, { MarketingLanding });
```
