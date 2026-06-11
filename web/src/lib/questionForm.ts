// 解析助手消息里的 <question-form>…</question-form>(别名 <ask-question>)。
// 对齐参照 artifacts/question-form.ts 的数据结构,裁剪:只取最后一个
// 表单、要求完整 JSON、direction-cards 降级 radio。
export type QuestionType = 'radio' | 'checkbox' | 'select' | 'text' | 'textarea';

export type FormOption = { label: string; value: string; description?: string };

export type FormQuestion = {
  id: string;
  label: string;
  type: QuestionType;
  options?: FormOption[];
  placeholder?: string;
  required?: boolean;
  help?: string;
};

export type QuestionForm = { id: string | null; title: string | null; questions: FormQuestion[] };

// 不支持嵌套标签:惰性匹配遇到嵌套 <question-form> 会在第一个闭合标签截断,
// 外层 JSON 解析失败被跳过,内层也不再独立匹配(模型输出不会嵌套,可接受)。
const FORM_RE = /<(question-form|ask-question)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
}

function normalizeOption(raw: unknown): FormOption | null {
  if (typeof raw === 'string') return { label: raw, value: raw };
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label : typeof o.value === 'string' ? o.value : null;
    if (!label) return null;
    return {
      label,
      value: typeof o.value === 'string' ? o.value : label,
      ...(typeof o.description === 'string' ? { description: o.description } : {}),
    };
  }
  return null;
}

function normalizeQuestion(raw: unknown): FormQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  if (typeof q.id !== 'string' || typeof q.label !== 'string') return null;
  const declared = typeof q.type === 'string' ? q.type : 'text';
  const type: QuestionType =
    declared === 'direction-cards'
      ? 'radio'
      : (['radio', 'checkbox', 'select', 'text', 'textarea'] as readonly string[]).includes(declared)
        ? (declared as QuestionType)
        : 'text';
  const options = Array.isArray(q.options)
    ? q.options.map(normalizeOption).filter((o): o is FormOption => o !== null)
    : undefined;
  return {
    id: q.id,
    label: q.label,
    type,
    ...(options && options.length > 0 ? { options } : {}),
    ...(typeof q.placeholder === 'string' ? { placeholder: q.placeholder } : {}),
    ...(typeof q.required === 'boolean' ? { required: q.required } : {}),
    ...(typeof q.help === 'string' ? { help: q.help } : {}),
  };
}

/** 取文本中最后一个合法表单;无表单或 JSON 不合法返回 null。 */
export function extractQuestionForm(text: string): QuestionForm | null {
  let last: QuestionForm | null = null;
  for (const m of text.matchAll(FORM_RE)) {
    try {
      const body = JSON.parse(m[3]) as { questions?: unknown[] };
      if (!Array.isArray(body.questions)) continue;
      const questions = body.questions
        .map(normalizeQuestion)
        .filter((q): q is FormQuestion => q !== null);
      if (questions.length === 0) continue;
      last = { id: attr(m[2], 'id'), title: attr(m[2], 'title'), questions };
    } catch {
      // 坏 JSON 跳过
    }
  }
  return last;
}
