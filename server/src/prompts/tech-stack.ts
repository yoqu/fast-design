/**
 * 原型默认技术栈 — 瘦身版（2026-06-13 重构）。
 * 系统提示只保留「恒须生效、与 skill 是否启用无关」的基础设施硬约束：
 * 固定版本运行时 + 国内镜像网络规则。完整作者契约（组件拆分 / 状态 / 动效 /
 * 设备框架 / token / 降级）已迁入 react-prototype skill 作为单一真相源，并对所有
 * 项目强制注入（pi-skills.ts 的 ALWAYS_ON_BUNDLED_SKILLS），此处仅留一行指针。
 * 注入位置：designAppendPrompts 的 locale → discovery → 本段 → metadata。
 */
export const TECH_STACK_PROMPT = `# Default tech stack (hard contract — every prototype artifact)

Build product/app prototypes as **React prototypes by default**, not plain HTML: \`.html\` shells per screen, interactive logic in JSX loaded through Babel standalone.

## Pinned runtime (copy exactly — versions and integrity hashes are non-negotiable)

Hosts are **China-mainland mirrors** so prototypes load fast without a VPN. \`registry.npmmirror.com\` (Alibaba) serves byte-identical npm files, so the integrity hashes stay valid — do not change them.

\`\`\`html
<script src="https://registry.npmmirror.com/react/18.3.1/files/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
<script src="https://registry.npmmirror.com/react-dom/18.3.1/files/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
<script src="https://registry.npmmirror.com/@babel/standalone/7.29.0/files/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>
<script src="https://cdn.tailwindcss.com/3.4.16"></script>
\`\`\`

Never use floating CDN URLs (\`@latest\`, unversioned). Never add \`type="module"\` to Babel scripts — it breaks transpilation.

## Network access (hard rule — every artifact must load fast from inside mainland China, no VPN)

- **Never reference the overseas central CDNs**: \`unpkg.com\`, \`cdn.jsdelivr.net\`, \`cdnjs.cloudflare.com\`, \`esm.sh\`, \`skypack.dev\`, \`fonts.googleapis.com\`, \`fonts.gstatic.com\`. They are slow or blocked in China — using them makes the prototype look broken.
- **Any extra JS/CSS library** beyond the pinned runtime must come from a China-reachable mirror — prefer \`https://registry.npmmirror.com/<pkg>/<version>/files/<path>\` (byte-identical to npm, SRI still matches). Acceptable alternatives: \`cdn.staticfile.net\`, \`lib.baomitu.com\`, \`cdn.bootcdn.net\`. Always pin an explicit version.
- **Fonts**: prefer a system font stack (\`-apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif\`) so nothing is fetched. If a web font is truly required, load it through \`https://fonts.loli.net/css2?...\` — never \`fonts.googleapis.com\` directly.

## Full authoring contract → react-prototype skill

The complete authoring contract — html-shell-per-screen file layout, \`window\`-shared JSX components, the \`css/tokens.css\` oklch token system, controlled-input/state rules, motion primitives, iOS/Android/browser device frames, and the single-file / offline fallback — lives in the **react-prototype** skill, which is injected into every prototype run. Before writing any prototype code, read its \`assets/template.html\` seed, \`references/layouts.md\`, and \`references/checklist.md\`, then copy the seed instead of hand-rolling shells.`;
