import type { Reason, ReasonRequest, ReasonResponse } from "./index.ts";

/**
 * A client for OpenAI-compatible chat completions (POST .../chat/completions), which
 * Alibaba Cloud Model Studio serves for Qwen on the same workspace as the decision model.
 */
export interface ChatOptions {
  /** The full endpoint, e.g. https://{workspace}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions */
  url: string;
  model: string;
  apiKey?: string;
  /** Qwen's thinking mode. Off by default: golems want quick, short lines. */
  thinking?: boolean;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

export class ChatError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ChatError";
    this.status = status;
  }
}

/** Refuse URLs that still contain a placeholder like {WorkspaceId}: the server would just answer 400. */
export function assertRealUrl(url: string): void {
  if (!/^https?:\/\//.test(url)) throw new ChatError(`Not an http(s) URL: ${url}`);
  const placeholder = /\{[^}]*\}/.exec(url);
  if (placeholder) throw new ChatError(`The URL still contains the placeholder ${placeholder[0]}; put your real value there: ${url}`);
}

export class ChatCompletionsHttp implements Reason {
  readonly name: string;
  readonly #o: ChatOptions;

  constructor(options: ChatOptions) {
    assertRealUrl(options.url);
    this.#o = options;
    this.name = options.model;
  }

  async complete(request: ReasonRequest, options: { signal?: AbortSignal } = {}): Promise<ReasonResponse> {
    const started = Date.now();
    const messages = [...(request.system ? [{ role: "system", content: request.system }] : []), ...request.messages];
    let res: Response;
    try {
      res = await (this.#o.fetch ?? fetch)(this.#o.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.#o.apiKey ? { authorization: `Bearer ${this.#o.apiKey}` } : {}) },
        body: JSON.stringify({
          model: this.#o.model,
          messages,
          stream: false,
          enable_thinking: this.#o.thinking ?? false,
          ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
        }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (e) {
      if (options.signal?.aborted) throw options.signal.reason;
      throw new ChatError(`Could not reach ${new URL(this.#o.url).host}: ${(e as Error).message}`);
    }
    const body = await res.text();
    const redact = (t: string) => (this.#o.apiKey ? t.split(this.#o.apiKey).join("[key]") : t);
    if (!res.ok) throw new ChatError(`Chat model answered ${res.status}: ${redact(body).slice(0, 300)}`, res.status);
    let text: unknown;
    try {
      // content only: reasoning_content (thinking) is deliberately ignored
      text = (JSON.parse(body) as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
    } catch {
      throw new ChatError(`Chat model answered with something that is not JSON: ${body.slice(0, 120)}`);
    }
    if (typeof text !== "string") throw new ChatError("Chat model gave no message content.");
    return { text, latencyMs: Date.now() - started };
  }
}

/**
 * A reason model from the environment, or undefined when none is configured:
 *   REASON_URL       the chat/completions endpoint
 *   REASON_MODEL     default qwen3.8-flash
 *   REASON_KEY       falls back to DASHSCOPE_API_KEY
 *   REASON_THINKING  "1" to turn thinking on
 */
export function reasonFromEnv(env: Record<string, string | undefined> = process.env): ChatCompletionsHttp | undefined {
  const url = env.REASON_URL;
  if (!url) return undefined;
  const apiKey = env.REASON_KEY ?? env.DASHSCOPE_API_KEY;
  return new ChatCompletionsHttp({
    url,
    model: env.REASON_MODEL ?? "qwen3.8-flash",
    thinking: env.REASON_THINKING === "1",
    ...(apiKey ? { apiKey } : {}),
  });
}
