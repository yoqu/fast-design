# Discovery 问答流程对齐（2026-06-11）

把 open-design 在 AI 对话中的「新建项目提示问答」链路一比一复刻进来：首轮
discovery 问卷 → 品牌分支 → TodoWrite 计划，以及 web 端完整的问卷渲染/作答/
回填体验。参照代码库 `/Users/yoqu/Documents/code/ai/open-design-slim`。

## 参照映射

| 本项目 | 参照 | 说明 |
| --- | --- | --- |
| `server/src/prompts/discovery.ts` | `packages/contracts/src/prompts/discovery.ts` | RULE 1/2/3 + 设计哲学，见下方裁剪 |
| `server/src/prompts/directions.ts` | `packages/contracts/src/prompts/directions.ts` | 5 方向库逐字移植 |
| `server/src/prompts/compose.ts` | `packages/contracts/src/prompts/system.ts` | locale override(固定 zh-CN) + renderMetadataBlock(裁剪到 prototype 字段) + 栈序 |
| `server/src/index.ts` `launchConfigFor` | daemon 组装层 | `designAppendPrompts(metadata)` 置于全局/项目指令之前，经 `pi --append-system-prompt` 注入 |
| `web/src/lib/partialJson.ts` | `apps/web/src/runtime/partial-json.ts` | 逐字移植 |
| `web/src/lib/questionForm.ts` | `apps/web/src/artifacts/question-form.ts` | 全量移植：direction-cards、maxSelections、defaultValue、description/submitLabel、splitOnQuestionForms、流式 parsePartialQuestionForm、formatFormAnswers |
| `web/src/components/QuestionForm.tsx` | `apps/web/src/components/QuestionForm.tsx` | 表单视图 + parseSubmittedAnswers，样式改 Tailwind，行为一致 |
| `web/src/components/QuestionsPanel.tsx` | `apps/web/src/components/QuestionsPanel.tsx` | 逐题 reveal(280ms)、120s 自动跳过倒计时、全部跳过/继续 |
| `web/src/components/ProjectView.tsx` 问卷派生块 | 参照 ProjectView.tsx:1086-1150 | 最后一条助手消息取首个表单、后续 `[form answers …]` 用户消息回填锁定、流式预览、occurrence key |
| `web/src/components/MessageView.tsx` | 参照 AssistantMessage 的切段 | 聊天里表单块渲染为占位卡（作答在右侧问题面板），流式未闭合表单不闪原始 JSON |

## 端到端弧线（同参照）

1. 创建项目 → pendingPrompt 预填 composer（不自动发，沿用既有语义）。
2. 用户发首条 brief → agent 按 RULE 1 输出一行 prose + `<question-form id="discovery">`（中文 locale override 给了默认中文文案）。
3. 流式期间：聊天显示「正在生成问题…」占位；Questions 标签自动打开，框架先出现、问题逐个流入（parsePartialQuestionForm + 280ms reveal）。
4. 用户作答 → `[form answers — discovery]\n- 标签: 值 [value: …]` 作为用户消息发送；未答字段 `(skipped)`；120 秒不操作自动按当前选择继续。
5. agent 按 RULE 2 分支：brand_spec/reference_match → 品牌提取写 brand-spec.md；否则自行从方向库选定方向（不再发第二个方向问卷，同参照 slim 行为）。
6. RULE 3：TodoWrite 计划 → 写文件 → checklist + 5 维自评 → 完成。

## 对参照的有意偏离（范围裁剪）

- **task-type 路由表单**：依赖插件/Home chip 体系，不在范围 → 删。
- **Active design system 例外段**：设计系统库不在范围 → 删。
- **`/frames/` 共享设备框架**：本应用不带这些静态资源 → 删该块，指示内联框架并保留 screens/ 目录结构建议。
- **deck framework directive**：deck renderer 不在范围 → RULE 3 的 deck 专段删除（表单里"幻灯片"选项保留）。
- **`<artifact>` 聊天协议**：本应用工件 = 写入项目目录的 HTML（artifacts.ts 自动推断 manifest）→ 相关措辞改为"写文件 + 聊天总结，禁止聊天里粘整页 HTML"。
- **locale**：参照由客户端传 locale，本应用 UI 固定中文 → 写死 zh-CN override。
- **手动重开历史表单（参照 #3661）**：未移植；表单回答后 Questions 标签直接关闭。
- **formKey**：参照用助手消息 id；本应用消息无 id，用 `会话id:消息下标`（流式与重载均稳定）。
- **AskUserQuestion 工具卡**（参照双轨之一）：pi 无该工具协议，问答统一走 `<question-form>` 单轨。

## 验证

- server：`compose.test.ts` 8 例（RULE 存在性、方向库 5 项、裁剪不引用 frames/artifact、metadata 分支、栈序）；全量 121 通过。
- web：`questionForm.test.ts` 13 例（首个表单、切段、direction-cards、别名、流式截断/部分解析、答案序列化/反解析）；全量 95 通过；tsc + vite build 通过。
