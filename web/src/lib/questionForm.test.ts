import { describe, expect, it } from 'vitest';
import {
  findFirstQuestionForm,
  formatFormAnswers,
  hasUnterminatedQuestionForm,
  parsePartialQuestionForm,
  splitOnQuestionForms,
  stripTrailingOpenQuestionForm,
} from './questionForm';
import { parseSubmittedAnswers } from '../components/QuestionForm';

const SAMPLE = `先确认两个问题。

<question-form id="discovery" title="快速确认">
{
  "description": "开始前先锁定这些。",
  "submitLabel": "继续",
  "questions": [
    { "id": "platform", "label": "平台", "type": "radio",
      "options": ["移动端", "桌面 Web"], "required": true },
    { "id": "tone", "label": "调性", "type": "checkbox", "maxSelections": 2,
      "options": ["极简", "编辑", "工具"] },
    { "id": "audience", "label": "目标用户", "type": "text", "placeholder": "如 SaaS 买家" }
  ]
}
</question-form>

回答后我继续。`;

describe('findFirstQuestionForm / splitOnQuestionForms', () => {
  it('解析表单与属性（含 description/submitLabel/maxSelections）', () => {
    const found = findFirstQuestionForm(SAMPLE);
    expect(found?.form.id).toBe('discovery');
    expect(found?.form.title).toBe('快速确认');
    expect(found?.form.description).toBe('开始前先锁定这些。');
    expect(found?.form.submitLabel).toBe('继续');
    expect(found?.form.questions).toHaveLength(3);
    expect(found?.form.questions[0].options).toEqual([
      { label: '移动端', value: '移动端' },
      { label: '桌面 Web', value: '桌面 Web' },
    ]);
    expect(found?.form.questions[1].maxSelections).toBe(2);
  });

  it('切段：prose + form + prose（聊天渲染用）', () => {
    const segs = splitOnQuestionForms(SAMPLE);
    expect(segs.map((s) => s.kind)).toEqual(['text', 'form', 'text']);
  });

  it('多个表单取第一个', () => {
    const two = `${SAMPLE}\n<question-form id="second"><!-- bad --></question-form>`;
    expect(findFirstQuestionForm(two)?.form.id).toBe('discovery');
  });

  it('支持 ask-question 别名与 ```json 围栏包裹', () => {
    const text = '<ask-question>```json\n{"questions":[{"id":"q","label":"Q","type":"text"}]}\n```</ask-question>';
    expect(findFirstQuestionForm(text)?.form.questions).toHaveLength(1);
  });

  it('direction-cards 保留富卡片元数据（不再降级 radio）', () => {
    const text = `<question-form id="direction">{"questions":[{"id":"d","label":"方向","type":"direction-cards","options":["a","b"],"cards":[{"id":"a","label":"Editorial","mood":"杂志感","references":["Monocle"],"palette":["#fff","#000"],"displayFont":"Georgia","bodyFont":"system-ui"}]}]}</question-form>`;
    const q = findFirstQuestionForm(text)!.form.questions[0];
    expect(q.type).toBe('direction-cards');
    expect(q.cards).toHaveLength(1);
    expect(q.cards![0]).toMatchObject({ id: 'a', label: 'Editorial', palette: ['#fff', '#000'] });
  });

  it('题型别名归一化（single→radio、multi→checkbox、dropdown→select）', () => {
    const text = `<question-form>{"questions":[
      {"id":"a","label":"A","type":"single","options":["x"]},
      {"id":"b","label":"B","type":"multi","options":["x"]},
      {"id":"c","label":"C","type":"dropdown","options":["x"]}
    ]}</question-form>`;
    const qs = findFirstQuestionForm(text)!.form.questions;
    expect(qs.map((q) => q.type)).toEqual(['radio', 'checkbox', 'select']);
  });

  it('无表单/坏 JSON 返回 null', () => {
    expect(findFirstQuestionForm('普通回复')).toBeNull();
    expect(findFirstQuestionForm('<question-form>{bad json</question-form>')).toBeNull();
  });
});

describe('流式处理', () => {
  const OPEN = '说明文字\n<question-form id="discovery" title="快速确认">\n{"questions":[{"id":"p","label":"平台","type":"radio","options":["移动端"]},{"id":"t","label":"调';

  it('stripTrailingOpenQuestionForm 截掉未闭合表单避免闪原始 JSON', () => {
    const { text, hadOpenForm } = stripTrailingOpenQuestionForm(OPEN);
    expect(hadOpenForm).toBe(true);
    expect(text).toBe('说明文字\n');
    expect(hasUnterminatedQuestionForm(OPEN)).toBe(true);
    expect(hasUnterminatedQuestionForm(SAMPLE)).toBe(false);
  });

  it('parsePartialQuestionForm 渐进给出已完成的问题', () => {
    const partial = parsePartialQuestionForm(OPEN);
    expect(partial?.id).toBe('discovery');
    expect(partial?.title).toBe('快速确认');
    // 第一题已闭合可见；第二题 label 未完成但有 id —— 也按流式规则出现。
    expect(partial?.questions.length).toBeGreaterThanOrEqual(1);
    expect(partial?.questions[0]).toMatchObject({ id: 'p', label: '平台', type: 'radio' });
  });

  it('parsePartialQuestionForm 无开标签返回 null', () => {
    expect(parsePartialQuestionForm('纯文本')).toBeNull();
  });
});

describe('formatFormAnswers / parseSubmittedAnswers', () => {
  const form = findFirstQuestionForm(SAMPLE)!.form;

  it('序列化为 [form answers — id] 格式，未答标记 (skipped)', () => {
    const text = formatFormAnswers(form, { platform: '移动端', tone: ['极简', '编辑'] });
    expect(text.split('\n')[0]).toBe('[form answers — discovery]');
    expect(text).toContain('- 平台: 移动端');
    expect(text).toContain('- 调性: 极简, 编辑');
    expect(text).toContain('- 目标用户: (skipped)');
  });

  it('label≠value 的选项带 [value: …] 稳定值', () => {
    const branded = findFirstQuestionForm(
      '<question-form id="d">{"questions":[{"id":"brand","label":"品牌","type":"radio","options":[{"label":"帮我选","value":"pick_direction"}]}]}</question-form>',
    )!.form;
    expect(formatFormAnswers(branded, { brand: 'pick_direction' })).toContain(
      '- 品牌: 帮我选 [value: pick_direction]',
    );
  });

  it('parseSubmittedAnswers 反向解析（含 [value:] 与 skipped）', () => {
    const sent = formatFormAnswers(form, { platform: '移动端', tone: ['极简'] });
    const parsed = parseSubmittedAnswers(form, sent);
    expect(parsed).toMatchObject({ platform: '移动端', tone: ['极简'], audience: '' });
    expect(parseSubmittedAnswers(form, '普通用户消息')).toBeNull();
  });
});
