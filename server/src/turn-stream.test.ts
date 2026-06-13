// server/src/turn-stream.test.ts
// 回归锁:回合 NDJSON 流必须把订阅建立后才发生的事件送达客户端。
// Node ≥16 里经 express.json() 读完请求体后,req 的 'close' 在 handler
// 一开始就触发(消息完成即 close,并非只在客户端断开时)——曾导致订阅
// 刚建立即被退订,客户端整回合收不到任何事件(UI 永远停在"连接中")。
import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Turn, pipeTurnToResponse } from './turns.js';

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

function listen(app: express.Express): Promise<number> {
  return new Promise((resolve) => {
    server = app.listen(0, () => resolve((server!.address() as AddressInfo).port));
  });
}

describe('pipeTurnToResponse', () => {
  it('POST 经 json 中间件:握手后异步发出的事件全部送达,结尾补 done', async () => {
    const app = express();
    app.use(express.json());
    const turn = new Turn(null);
    app.post('/chat', (_req, res) => {
      pipeTurnToResponse(turn, res);
      // 模拟回合:订阅建立后(下一拍起)才陆续产生事件。
      setTimeout(() => {
        turn.emit({ type: 'status', label: 'working' });
        turn.emit({ type: 'text_delta', delta: '你好' });
        turn.end();
      }, 30);
    });
    const port = await listen(app);

    const res = await fetch(`http://127.0.0.1:${port}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { type: 'status', label: 'working' },
      { type: 'text_delta', delta: '你好' },
      { type: 'done' },
    ]);
  });

  it('订阅时回放已缓冲事件(刷新续接语义),已结束回合立即补 done 并断流', async () => {
    const app = express();
    const turn = new Turn(null);
    turn.emit({ type: 'text_delta', delta: '已缓冲' });
    turn.end();
    app.get('/stream', (_req, res) => {
      pipeTurnToResponse(turn, res);
    });
    const port = await listen(app);

    const res = await fetch(`http://127.0.0.1:${port}/stream`);
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toEqual([{ type: 'text_delta', delta: '已缓冲' }, { type: 'done' }]);
  });
});
