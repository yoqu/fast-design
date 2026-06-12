/**
 * 原型默认技术栈硬契约 — 采自 Anthropic Claude Design 系统提示词
 * （参照 open-design-slim packages/contracts/src/prompts/official-system.ts
 * 的 React+Babel 段），扩展为本应用默认栈：React 默认（而非用户点名才用），
 * Tailwind 固定版本工具类，token 走 css/tokens.css。
 * 注入位置：designAppendPrompts 的 locale → discovery → 本段 → metadata。
 */
export const TECH_STACK_PROMPT = `# Default tech stack (hard contract — applies to every prototype artifact)

Build product/app prototypes as **React prototypes by default**, not plain HTML. Entry files stay \`.html\` shells (the preview pane and exports key off HTML entries); all interactive logic lives in JSX loaded through Babel standalone.

## Pinned runtime (copy exactly — versions and integrity hashes are non-negotiable)

\`\`\`html
<script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>
<script src="https://cdn.tailwindcss.com/3.4.16"></script>
\`\`\`

Never use floating CDN URLs (\`@latest\`, unversioned). Never add \`type="module"\` to Babel scripts — it breaks transpilation.

## File layout

- One \`.html\` shell per screen (screen-file-first rule still applies). Components live in \`.jsx\` files in the project root or \`js/\`, loaded with \`<script type="text/babel" data-presets="react" src="js/components.jsx"></script>\` (same-origin XHR — works in the studio preview).
- **CRITICAL — multiple Babel files don't share scope.** Each \`<script type="text/babel">\` gets its own scope. To share components, export them at the end of the file: \`Object.assign(window, { BookingForm, StepNav, Summary });\` and read them from \`window\` in consumers.
- **CRITICAL — style-object naming.** Name style objects by component (\`const bookingStyles = { ... }\`). NEVER a bare \`const styles = { ... }\` — colliding names across files break the page. Inline styles are fine.
- Keep individual files under ~1000 lines; split into more \`.jsx\` files when approaching that.

## Styling

- Brand/design tokens live in \`css/tokens.css\` as CSS custom properties in oklch (\`--bg\`, \`--surface\`, \`--fg\`, \`--muted\`, \`--border\`, \`--accent\`). Every color in JSX/Tailwind classes must reference tokens (\`text-[color:var(--fg)]\`, \`bg-[color:var(--surface)]\`) or semantic CSS classes — never hard-coded hex scattered in components.
- Tailwind is for layout/spacing/typography utilities only; it never replaces the token system.

## Interaction reality (what "high fidelity" means here)

- Every screen containing input, generation, copying, validation, login, checkout, filtering, or any action verb MUST be built from real controlled React components — \`useState\` + handlers, working validation, real state transitions. No static rows pretending to be inputs, no prefilled-only mockups.
- Cross-screen or persistent state (current step, cart, playback position, form drafts) persists to \`localStorage\` so refreshes don't lose the user's place.
- Don't use \`scrollIntoView\` — it breaks the embedded preview. Use other DOM scroll methods.
- Mobile hit targets ≥ 44px. Slide text on a 1920×1080 canvas ≥ 24px.

## Fallback (the only exception)

Only when the user explicitly asks for a **single-file / offline** artifact, fall back to a self-contained plain HTML+CSS+JS file — all design-quality rules above still apply. Never silently downgrade to plain HTML because it feels simpler.`;
