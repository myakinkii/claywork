import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Choice, Noul, Score, SystemOneHttp, getChoice, getNoul, getScore, reflexFromEnv } from "@claywork/reflex";

/** The response decision-model-preview actually gave for the ticket example. */
const REAL = {
  model: "decision-model-preview",
  request_id: "d075d12c-aec9-90ee-a516-77bf46a758f2",
  answers: {
    department: { type: "choice", choice: "billing", confidence: 0.95, probabilities: { billing: 0.98, technical: 0.02 } },
    escalate: { type: "noul", noul: 0.97 },
    severity: {
      type: "score",
      score: 2.26,
      legend: { "0": "Minor", "1": "Partial", "2": "Core unavailable", "3": "Severe" },
      probabilities: { "0": 0.0, "1": 0.02, "2": 0.71, "3": 0.28 },
      confidence: 0.9,
    },
  },
  usage: { input_tokens: 141 },
  latency_ms: 322.4,
};

const QUESTIONS = {
  department: Choice("Which team should handle this?", { billing: "Payment, refund, and billing issues", technical: "Product malfunctions" }),
  escalate: Noul("Does the on-call staff need to be notified immediately?"),
  severity: Score("How severe is this issue?", ["Minor", "Partial", "Core unavailable", "Severe"]),
};

/** A tiny System One server: records requests, answers with whatever the test says. */
async function mock(reply: (req: IncomingMessage, body: unknown) => { status?: number; body: unknown; delayMs?: number }) {
  const seen: { headers: IncomingMessage["headers"]; body: any; url: string | undefined }[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    seen.push({ headers: req.headers, body, url: req.url });
    const r = reply(req, body);
    if (r.delayMs) await new Promise((ok) => setTimeout(ok, r.delayMs));
    if (res.destroyed) return;
    res.writeHead(r.status ?? 200, { "content-type": "application/json" });
    res.end(typeof r.body === "string" ? r.body : JSON.stringify(r.body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/compatible-mode/v1/systemone`;
  return { url, seen, close: () => server.close() };
}

test("speaks the protocol and maps the real response into our answers", async () => {
  const m = await mock(() => ({ body: REAL }));
  try {
    const reflex = new SystemOneHttp({ url: m.url, model: "decision-model-preview", apiKey: "sk-test" });
    const res = await reflex.ask({ state: { ticket_id: "T-1001" }, questions: QUESTIONS });

    const sent = m.seen[0]!;
    assert.equal(sent.url, "/compatible-mode/v1/systemone");
    assert.equal(sent.headers.authorization, "Bearer sk-test");
    assert.deepEqual(sent.body, { model: "decision-model-preview", state: { ticket_id: "T-1001" }, questions: JSON.parse(JSON.stringify(QUESTIONS)) });

    assert.deepEqual(getChoice(res, "department"), { type: "choice", choice: "billing", probabilities: { billing: 0.98, technical: 0.02 }, confidence: 0.95 });
    assert.deepEqual(getNoul(res, "escalate"), { type: "noul", noul: 0.97 });
    assert.deepEqual(getScore(res, "severity"), { type: "score", score: 2.26, probabilities: [0, 0.02, 0.71, 0.28], confidence: 0.9 }, "level-keyed object becomes an array");
    assert.equal(res.latencyMs, 322.4);
    assert.equal(res.inputTokens, 141);
    assert.equal(res.requestId, REAL.request_id);
  } finally {
    m.close();
  }
});

test("errors explain themselves without leaking the key", async () => {
  const m = await mock(() => ({ status: 401, body: { code: "InvalidApiKey", message: "Invalid API-key provided: sk-secret-123" } }));
  try {
    const reflex = new SystemOneHttp({ url: m.url, model: "decision-model-preview", apiKey: "sk-secret-123" });
    await assert.rejects(reflex.ask({ state: "x", questions: QUESTIONS }), (e: Error & { status?: number }) => {
      assert.equal(e.status, 401);
      assert.match(e.message, /answered 401/);
      assert.doesNotMatch(e.message, /sk-secret-123/);
      return true;
    });
  } finally {
    m.close();
  }
});

test("a choice outside the options is refused, not trusted", async () => {
  const bad = structuredClone(REAL);
  bad.answers.department.choice = "teleport";
  const m = await mock(() => ({ body: bad }));
  try {
    const reflex = new SystemOneHttp({ url: m.url, model: "m" });
    await assert.rejects(reflex.ask({ state: "x", questions: QUESTIONS }), /chose "teleport", which is not one of the options/);
  } finally {
    m.close();
  }
});

test("the golem's deadline aborts the request", async () => {
  const m = await mock(() => ({ body: REAL, delayMs: 500 }));
  try {
    const reflex = new SystemOneHttp({ url: m.url, model: "m" });
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("deadline")), 30);
    await assert.rejects(reflex.ask({ state: "x", questions: QUESTIONS }, { signal: controller.signal }), /deadline/);
  } finally {
    m.close();
  }
});

test("configured from the environment, or not at all", () => {
  assert.equal(reflexFromEnv({}), undefined, "no URL: the world falls back to its fakes");
  const r = reflexFromEnv({ REFLEX_URL: "https://ws.example.com/compatible-mode/v1/systemone", DASHSCOPE_API_KEY: "sk-x" });
  assert.equal(r?.name, "decision-model-preview");
});

test("a URL with a leftover placeholder is refused before any request", () => {
  assert.throws(
    () => new SystemOneHttp({ url: "https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/systemone", model: "m" }),
    /still contains the placeholder \{WorkspaceId\}/,
  );
});
