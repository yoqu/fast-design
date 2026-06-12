# react-prototype 自查单

## P0（任一不过不得交付）
- [ ] 所有共享组件文件末尾 `Object.assign(window, {...})`；消费方无裸引用未暴露组件
- [ ] 无 `scrollIntoView` 调用
- [ ] 含动作动词的屏幕全部为真实受控组件（输入可打字、校验可触发、状态可流转）
- [ ] 360px 视口无横向滚动
- [ ] CDN 四件套版本与 integrity 与契约完全一致；无 `@latest`、无 `type="module"`
- [ ] 样式对象按组件命名，无 `const styles = {`
- [ ] 颜色全部引用 css/tokens.css 的 token；无散落硬编码 hex
- [ ] 触控目标 ≥ 44px；移动屏套设备框架组件

## P1
- [ ] 跨屏/持久状态写 localStorage，刷新不丢
- [ ] hover/focus/active/disabled 四态齐全
- [ ] 单文件 < 1000 行
- [ ] 动画仅 transform/opacity
- [ ] 空/加载/错误态有真实呈现

## P2
- [ ] `text-wrap: pretty`、container queries 等现代 CSS 用在该用的地方
- [ ] 键盘可达：对话框 Esc 关闭、表单 Enter 提交
- [ ] 诚实占位（`—`/灰块/标注 stub）而非编造数据
