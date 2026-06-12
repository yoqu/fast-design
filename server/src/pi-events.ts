import type { JsonRecord, UiEvent } from './types.js';

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function getRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

/**
 * Map a single pi `--mode rpc` stdout event to zero or more UI events.
 * Returns 'agent_end' when the turn is finished, null otherwise.
 *
 * Protocol reference: pi streams JSON lines like agent_start, turn_start,
 * message_update (with assistantMessageEvent deltas), tool_execution_start/end,
 * turn_end (carries usage) and agent_end.
 */
export function mapPiEvent(raw: JsonRecord, emit: (ev: UiEvent) => void): 'agent_end' | null {
  switch (raw.type) {
    case 'agent_start':
      emit({ type: 'status', label: 'working' });
      return null;
    case 'agent_end':
      // willRetry=true：pi 即将对可重试错误（流中断/限流等）退避后自动续跑，
      // 回合还没结束。这里提前收尾会让 webui 空闲而 pi 仍在流式，后续
      // prompt 全被 "Agent is already processing" 拒绝。
      return raw.willRetry === true ? null : 'agent_end';
    case 'turn_start':
      emit({ type: 'status', label: 'thinking' });
      emit({ type: 'turn_start' });
      return null;
    case 'turn_end': {
      const message = getRecord(raw.message);
      const usage = getRecord(message?.usage);
      if (usage) {
        const cost = getRecord(usage.cost);
        emit({
          type: 'usage',
          inputTokens: typeof usage.input === 'number' ? usage.input : undefined,
          outputTokens: typeof usage.output === 'number' ? usage.output : undefined,
          costUsd: typeof cost?.total === 'number' ? cost.total : null,
        });
      }
      if (message?.stopReason === 'error') {
        const text = typeof message.errorMessage === 'string' && message.errorMessage
          ? message.errorMessage
          : 'Pi agent error';
        emit({ type: 'error', message: text });
      }
      return null;
    }
    case 'message_update': {
      const ev = getRecord(raw.assistantMessageEvent);
      if (!ev) return null;
      if (ev.type === 'text_delta' && typeof ev.delta === 'string') {
        emit({ type: 'text_delta', delta: ev.delta });
      } else if (ev.type === 'thinking_delta' && typeof ev.delta === 'string') {
        emit({ type: 'thinking_delta', delta: ev.delta });
      } else if (ev.type === 'thinking_start') {
        emit({ type: 'thinking_start' });
      } else if (ev.type === 'thinking_end') {
        emit({ type: 'thinking_end' });
      } else if (ev.type === 'error') {
        const message =
          typeof ev.reason === 'string' && ev.reason
            ? ev.reason
            : typeof ev.delta === 'string' && ev.delta
              ? ev.delta
              : 'Agent error';
        emit({ type: 'error', message });
      }
      return null;
    }
    case 'tool_execution_start':
      emit({
        type: 'tool_use',
        id: typeof raw.toolCallId === 'string' ? raw.toolCallId : null,
        name: typeof raw.toolName === 'string' ? raw.toolName : null,
        input: raw.args ?? null,
      });
      return null;
    case 'tool_execution_end': {
      const result = getRecord(raw.result);
      const content = result?.content;
      const text = Array.isArray(content)
        ? content
            .map((c) => {
              const item = getRecord(c);
              return item?.type === 'text' ? String(item.text ?? '') : JSON.stringify(c);
            })
            .join('\n')
        : typeof content === 'string'
          ? content
          : '';
      emit({
        type: 'tool_result',
        toolUseId: typeof raw.toolCallId === 'string' ? raw.toolCallId : null,
        content: text,
        isError: raw.isError === true,
      });
      return null;
    }
    case 'extension_error': {
      const message = typeof raw.error === 'string' && raw.error ? raw.error : 'Extension error';
      emit({ type: 'error', message });
      return null;
    }
    case 'compaction_start':
      emit({ type: 'status', label: 'compacting' });
      return null;
    case 'auto_retry_start':
      emit({ type: 'status', label: 'retrying' });
      // pi 会把出错的 assistant 消息从上下文移除并整回合重发，
      // 通知消费方回滚该回合已收到的半截输出。
      emit({ type: 'retry' });
      return null;
    case 'auto_retry_end':
      if (raw.success === false) {
        const message =
          typeof raw.finalError === 'string' && raw.finalError ? raw.finalError : 'Auto-retry exhausted';
        emit({ type: 'error', message });
        // 重试在退避中被取消（abort）时 pi 不会再发 agent_end，这里就是终点；
        // 重试次数耗尽的路径里 agent_end(willRetry:false) 先到、回合已收尾，
        // 此事件会因 emit 已清空而被丢弃，不会双重收尾。
        return 'agent_end';
      }
      return null;
    default:
      return null;
  }
}

/** Incremental JSON-lines parser for pi's stdout. */
export function createJsonLineParser(onLine: (value: JsonRecord) => void) {
  let buffer = '';
  return {
    feed(chunk: string) {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          if (isRecord(parsed)) onLine(parsed);
        } catch {
          // Non-JSON noise on stdout (e.g. stray logs) — skip the line.
        }
      }
    },
    flush() {
      const line = buffer.trim();
      buffer = '';
      if (!line) return;
      try {
        const parsed = JSON.parse(line);
        if (isRecord(parsed)) onLine(parsed);
      } catch {
        // ignore
      }
    },
  };
}
