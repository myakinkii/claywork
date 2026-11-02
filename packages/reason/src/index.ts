/**
 * Reason: a model-agnostic System Two interface.
 *
 * Slow, generative work: NPC conversation, quest-giving, setting a golem's goal,
 * and later the Potter that generates whole scenarios. Any language model (or an
 * ADK agent) can sit behind this interface; FakeReason keeps everything testable.
 */

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface ReasonRequest {
  system?: string;
  messages: Message[];
  maxTokens?: number;
}

export interface ReasonResponse {
  text: string;
  latencyMs: number;
}

export interface Reason {
  readonly name: string;
  complete(request: ReasonRequest, options?: { signal?: AbortSignal }): Promise<ReasonResponse>;
}

/** Parse JSON from model text, tolerating ```json fences and surrounding prose. */
export function parseJson<T = unknown>(text: string): T {
  const unfenced = text.replace(/```(?:json)?/g, "").trim();
  const start = unfenced.search(/[[{]/);
  const end = Math.max(unfenced.lastIndexOf("}"), unfenced.lastIndexOf("]"));
  if (start < 0 || end < start) throw new Error("No JSON found in model output");
  return JSON.parse(unfenced.slice(start, end + 1)) as T;
}

export type Script = string[] | ((request: ReasonRequest, call: number) => string);

/** Replies from a script: a list (cycled) or a function of the request. */
export class FakeReason implements Reason {
  readonly name = "fake-reason";
  readonly #script: Script;
  readonly #latencyMs: number;
  readonly requests: ReasonRequest[] = [];

  constructor(script: Script, options: { latencyMs?: number } = {}) {
    this.#script = script;
    this.#latencyMs = options.latencyMs ?? 0;
  }

  async complete(request: ReasonRequest, options: { signal?: AbortSignal } = {}): Promise<ReasonResponse> {
    const started = Date.now();
    const call = this.requests.length;
    this.requests.push(request);
    if (this.#latencyMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.#latencyMs);
        options.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(options.signal!.reason);
        }, { once: true });
      });
    }
    const text = typeof this.#script === "function" ? this.#script(request, call) : (this.#script[call % this.#script.length] ?? "");
    return { text, latencyMs: Date.now() - started };
  }
}

export { ChatCompletionsHttp, ChatError, assertRealUrl, reasonFromEnv, type ChatOptions } from "./http.ts";
