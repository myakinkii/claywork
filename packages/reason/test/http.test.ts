import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { ChatCompletionsHttp, reasonFromEnv } from "@claywork/reason";

/** Shaped like Model Studio's real answer, with thinking on (reasoning_content present). */
const REAL = {
  id: "chatcmpl-6322ddc9",
  object: "chat.completion",
  model: "qwen3.8-flash",
  choices: [{ index: 0, message: { role: "assistant", reasoning_content: "We need answer user...", content: "Pebble leans into your hand." }, finish_reason: "stop" }],
  usage: { prompt_tokens: 64, completion_tokens: 133 },
};

async function mock(reply: (body: any) => { status?: number; body: unknown; delayMs?: number }) {
  const seen: { headers: Record<string, unknown>; body: any }[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    seen.push({ headers: req.headers, body });
    const r = reply(body);
    if (r.delayMs) await new Promise((ok) => setTimeout(ok, r.delayMs));
    if (res.destroyed) return;
    res.writeHead(r.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(r.body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/compatible-mode/v1/chat/completions`, seen, close: () => server.close() };
}

test("speaks chat completions, thinking off, and returns only the content", async () => {
  const m = await mock(() => ({ body: REAL }));
  try {
    const chat = new ChatCompletionsHttp({ url: m.url, model: "qwen3.8-flash", apiKey: "sk-test" });
    const res = await chat.complete({ system: "You are Pebble.", messages: [{ role: "user", content: "Max pets you." }] });
    assert.equal(res.text, "Pebble leans into your hand.", "reasoning_content is ignored");
    const sent = m.seen[0]!;
    assert.equal(sent.headers.authorization, "Bearer sk-test");
    assert.deepEqual(sent.body.messages, [{ role: "system", content: "You are Pebble." }, { role: "user", content: "Max pets you." }]);
    assert.equal(sent.body.enable_thinking, false);
    assert.equal(sent.body.stream, false);
  } finally {
    m.close();
  }
});

test("errors are explained without the key; placeholders are refused; deadlines abort", async () => {
  const m = await mock(() => ({ status: 401, body: { message: "Invalid API-key provided: sk-secret" } }));
  try {
    const chat = new ChatCompletionsHttp({ url: m.url, model: "m", apiKey: "sk-secret" });
    await assert.rejects(chat.complete({ messages: [] }), (e: Error) => /answered 401/.test(e.message) && !e.message.includes("sk-secret"));
  } finally {
    m.close();
  }
  assert.throws(() => new ChatCompletionsHttp({ url: "https://{WorkspaceId}.x/compatible-mode/v1/chat/completions", model: "m" }), /placeholder \{WorkspaceId\}/);
  const slow = await mock(() => ({ body: REAL, delayMs: 500 }));
  try {
    const chat = new ChatCompletionsHttp({ url: slow.url, model: "m" });
    await assert.rejects(chat.complete({ messages: [] }, { signal: AbortSignal.timeout(30) }));
  } finally {
    slow.close();
  }
});

test("configured from the environment, or not at all", () => {
  assert.equal(reasonFromEnv({}), undefined);
  assert.equal(reasonFromEnv({ REASON_URL: "https://ws.example.com/compatible-mode/v1/chat/completions", DASHSCOPE_API_KEY: "k" })?.name, "qwen3.8-flash");
});
