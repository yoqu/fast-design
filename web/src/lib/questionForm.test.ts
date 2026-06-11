import { describe, expect, it } from 'vitest';
import { extractQuestionForm } from './questionForm';

const SAMPLE = `先确认两个问题。

<question-form id="discovery" title="快速确认">
{
  "questions": [
    { "id": "platform", "label": "平台", "type": "radio",
      "options": ["移动端", "桌面 Web"], "required": true },
    { "id": "audience", "label": "目标用户", "type": "text", "placeholder": "如 SaaS 买家" }
  ]
}
</question-form>

回答后我继续。`;

describe('extractQuestionForm', () => {
  it('解析表单与属性', () => {
    const form = extractQuestionForm(SAMPLE);
    expect(form?.id).toBe('discovery');
    expect(form?.title).toBe('快速确认');
    expect(form?.questions).toHaveLength(2);
    expect(form?.questions[0].options).toEqual([
      { label: '移动端', value: '移动端' },
      { label: '桌面 Web', value: '桌面 Web' },
    ]);
  });
  it('支持 ask-question 别名', () => {
    const text = '<ask-question>{"questions":[{"id":"q","label":"Q","type":"text"}]}</ask-question>';
    expect(extractQuestionForm(text)?.questions).toHaveLength(1);
  });
  it('direction-cards 降级为 radio', () => {
    const text = '<question-form>{"questions":[{"id":"d","label":"方向","type":"direction-cards","options":["A","B"]}]}</question-form>';
    expect(extractQuestionForm(text)?.questions[0].type).toBe('radio');
  });
  it('无表单/坏 JSON 返回 null', () => {
    expect(extractQuestionForm('普通回复')).toBeNull();
    expect(extractQuestionForm('<question-form>{bad json</question-form>')).toBeNull();
  });
});
