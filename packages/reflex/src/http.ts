import { confidence, type Answer, type Question, type Reflex, type ReflexRequest, type ReflexResponse } from "./index.ts";

/**
 * A client for the TypeSafe System One protocol (POST .../v1/systemone), spoken by Jev,
 * by djev-run serving DiffusionGemma, and by Alibaba Cloud Model Studio's
 * decision-model-preview. One adapter, configured by endpoint, model and key.
 */
export interface SystemOneOptions {
  /** The full endpoint, e.g. https://{workspace}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/systemone */
  url: string;
  model: string;
  apiKey?: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

/** The protocol's answer shapes, as they arrive on the wire. */
interface WireAnswer {
  type: "choice" | "noul" | "score";
  choice?: string;
  noul?: number;
  score?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}

interface WireResponse {
  answers?: Record<string, WireAnswer>;
  latency_ms?: number;
  request_id?: string;
  usage?: { input_tokens?: number };
}

export class SystemOneError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "SystemOneError";
    this.status = status;
  }
}

export class SystemOneHttp implements Reflex {
  readonly name: string;
  readonly #options: SystemOneOptions;

  constructor(options: SystemOneOptions) {
    if (!/^https?:\/\//.test(options.url)) throw new SystemOneError(`Not an http(s) URL: ${options.url}`);
    const placeholder = /\{[^}]*\}/.exec(options.url);
    if (placeholder) throw new SystemOneError(`The URL still contains the placeholder ${placeholder[0]}; put your real value there: ${options.url}`);
    this.#options = options;
    this.name = options.model;
  }

  async ask(request: ReflexRequest, options: { signal?: AbortSignal } = {}): Promise<ReflexResponse> {
    const started = Date.now();
    const doFetch = this.#options.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(this.#options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.#options.apiKey ? { authorization: `Bearer ${this.#options.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.#options.model, state: request.state, questions: request.questions }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (e) {
      if (options.signal?.aborted) throw options.signal.reason;
      throw new SystemOneError(`Could not reach ${new URL(this.#options.url).host}: ${(e as Error).message}`);
    }
    const body = await res.text();
    if (!res.ok) throw new SystemOneError(`System One answered ${res.status}: ${redact(body, this.#options.apiKey).slice(0, 300)}`, res.status);

    let wire: WireResponse;
    try {
      wire = JSON.parse(body) as WireResponse;
    } catch {
      throw new SystemOneError(`System One answered with something that is not JSON: ${body.slice(0, 120)}`);
    }
    const answers: Record<string, Answer> = {};
    for (const [key, question] of Object.entries(request.questions)) {
      const a = wire.answers?.[key];
      if (!a) throw new SystemOneError(`System One gave no answer for "${key}".`);
      answers[key] = toAnswer(key, question, a);
    }
    return {
      answers,
      latencyMs: typeof wire.latency_ms === "number" ? wire.latency_ms : Date.now() - started,
      ...(wire.request_id ? { requestId: wire.request_id } : {}),
      ...(wire.usage?.input_tokens !== undefined ? { inputTokens: wire.usage.input_tokens } : {}),
    };
  }
}

function toAnswer(key: string, question: Question, a: WireAnswer): Answer {
  if (a.type !== question.type) throw new SystemOneError(`"${key}" was asked as ${question.type} but answered as ${a.type}.`);
  switch (question.type) {
    case "choice": {
      if (typeof a.choice !== "string" || !(a.choice in question.criteria)) {
        throw new SystemOneError(`"${key}" chose ${JSON.stringify(a.choice)}, which is not one of the options.`);
      }
      const probabilities = a.probabilities ?? { [a.choice]: 1 };
      return {
        type: "choice",
        choice: a.choice,
        probabilities,
        confidence: a.confidence ?? confidence(Object.values(probabilities)),
      };
    }
    case "score": {
      // The wire keys levels by index ("0", "1", ...); our interface uses an array.
      const probabilities = question.criteria.map((_, i) => a.probabilities?.[String(i)] ?? 0);
      return {
        type: "score",
        score: a.score ?? probabilities.reduce((acc, p, i) => acc + p * i, 0),
        probabilities,
        confidence: a.confidence ?? confidence(probabilities),
      };
    }
    case "noul":
      if (typeof a.noul !== "number") throw new SystemOneError(`"${key}" has no yes-probability.`);
      return { type: "noul", noul: a.noul };
  }
}

function redact(text: string, secret: string | undefined): string {
  return secret ? text.split(secret).join("[key]") : text;
}

/**
 * A reflex from the environment, or undefined when none is configured:
 *   REFLEX_URL    the systemone endpoint
 *   REFLEX_MODEL  default decision-model-preview
 *   REFLEX_KEY    falls back to DASHSCOPE_API_KEY
 */
export function reflexFromEnv(env: Record<string, string | undefined> = process.env): SystemOneHttp | undefined {
  const url = env.REFLEX_URL;
  if (!url) return undefined;
  const apiKey = env.REFLEX_KEY ?? env.DASHSCOPE_API_KEY;
  return new SystemOneHttp({ url, model: env.REFLEX_MODEL ?? "decision-model-preview", ...(apiKey ? { apiKey } : {}) });
}
