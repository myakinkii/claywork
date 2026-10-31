/**
 * Reflex: a model-agnostic System One interface.
 *
 * A System One model does not generate text. It reads a state and answers typed
 * questions in one pass, with probabilities: Choice (pick one of named options),
 * Score (position on ordered levels) and Noul (probability of yes).
 * Shaped after the Jev / DiffusionGemma "systemone" style so a real adapter is a
 * thin HTTP client, and FakeReflex makes everything testable offline.
 */

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** option -> one line description. The description is how the model learns the rules. */
  criteria: Record<string, string>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  /** Ordered levels, lowest first, 2 to 10 of them. */
  criteria: string[];
}

export interface NoulQuestion {
  type: "noul";
  instructions: string;
}

export type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion;

export const Choice = (instructions: string, criteria: Record<string, string>): ChoiceQuestion => ({ type: "choice", instructions, criteria });
export const Score = (instructions: string, criteria: string[]): ScoreQuestion => ({ type: "score", instructions, criteria });
export const Noul = (instructions: string): NoulQuestion => ({ type: "noul", instructions });

export interface ReflexRequest {
  /** Whatever is being judged: text, JSON, a list. */
  state: unknown;
  questions: Record<string, Question>;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ScoreAnswer {
  type: "score";
  /** Probability-weighted level index, e.g. 1.35 = between level 1 and 2. */
  score: number;
  probabilities: number[];
  confidence: number;
}

export interface NoulAnswer {
  type: "noul";
  /** Probability that the answer is yes. */
  noul: number;
}

export type Answer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export interface ReflexResponse {
  answers: Record<string, Answer>;
  latencyMs: number;
}

export interface Reflex {
  readonly name: string;
  ask(request: ReflexRequest, options?: { signal?: AbortSignal }): Promise<ReflexResponse>;
}

// --- helpers ------------------------------------------------------------------

export function softmax(logits: number[]): number[] {
  if (!logits.length) return [];
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/** 1 when all mass is on one option, 0 for an even spread: (n * max - 1) / (n - 1). */
export function confidence(probabilities: number[]): number {
  const n = probabilities.length;
  if (n < 2) return 1;
  const max = Math.max(...probabilities);
  return Math.max(0, Math.min(1, (n * max - 1) / (n - 1)));
}

export function choiceAnswer(options: string[], probabilities: number[]): ChoiceAnswer {
  let best = 0;
  probabilities.forEach((p, i) => {
    if (p > probabilities[best]!) best = i;
  });
  return {
    type: "choice",
    choice: options[best]!,
    probabilities: Object.fromEntries(options.map((o, i) => [o, probabilities[i]!])),
    confidence: confidence(probabilities),
  };
}

export function scoreAnswer(probabilities: number[]): ScoreAnswer {
  return {
    type: "score",
    score: probabilities.reduce((acc, p, i) => acc + p * i, 0),
    probabilities,
    confidence: confidence(probabilities),
  };
}

/** Typed accessors that fail loudly when a question is missing or of another type. */
export function getChoice(res: ReflexResponse, key: string): ChoiceAnswer {
  const a = res.answers[key];
  if (a?.type !== "choice") throw new Error(`No choice answer for "${key}"`);
  return a;
}
export function getScore(res: ReflexResponse, key: string): ScoreAnswer {
  const a = res.answers[key];
  if (a?.type !== "score") throw new Error(`No score answer for "${key}"`);
  return a;
}
export function getNoul(res: ReflexResponse, key: string): NoulAnswer {
  const a = res.answers[key];
  if (a?.type !== "noul") throw new Error(`No noul answer for "${key}"`);
  return a;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

// --- the fake -----------------------------------------------------------------

/**
 * A rule can override the fake's judgement for a question. Return logits per option
 * (choice), per level (score, as an array), or a probability (noul); undefined = no opinion.
 */
export type FakeRule = (ctx: { key: string; question: Question; state: unknown; text: string }) =>
  | Record<string, number>
  | number[]
  | number
  | undefined;

export interface FakeReflexOptions {
  /** Simulated latency, a number or [min, max]. Default 0. */
  latencyMs?: number | [number, number];
  rules?: FakeRule[];
  /** How sharp the default heuristic is. Higher = more confident. Default 3. */
  temperature?: number;
}

/**
 * Deterministic stand-in for a System One model. By default it scores options by
 * word overlap between the state and each option's description, which is crude but
 * stable; rules let tests and demos script sharper behaviour.
 */
export class FakeReflex implements Reflex {
  readonly name = "fake-reflex";
  readonly #options: FakeReflexOptions;
  #calls = 0;

  constructor(options: FakeReflexOptions = {}) {
    this.#options = options;
  }

  get calls(): number {
    return this.#calls;
  }

  async ask(request: ReflexRequest, options: { signal?: AbortSignal } = {}): Promise<ReflexResponse> {
    this.#calls += 1;
    const started = Date.now();
    const latency = this.#options.latencyMs ?? 0;
    const ms = Array.isArray(latency) ? latency[0] + ((this.#calls * 7919) % (latency[1] - latency[0] + 1)) : latency;
    if (ms > 0) await sleep(ms, options.signal);

    const text = (typeof request.state === "string" ? request.state : JSON.stringify(request.state)).toLowerCase();
    const answers: Record<string, Answer> = {};
    for (const [key, question] of Object.entries(request.questions)) {
      answers[key] = this.#answer(key, question, request.state, text);
    }
    return { answers, latencyMs: Date.now() - started };
  }

  #answer(key: string, question: Question, state: unknown, text: string): Answer {
    let ruled: ReturnType<FakeRule>;
    for (const rule of this.#options.rules ?? []) {
      ruled = rule({ key, question, state, text });
      if (ruled !== undefined) break;
    }
    const temperature = this.#options.temperature ?? 3;
    const stateWords = words(text);

    switch (question.type) {
      case "choice": {
        const options = Object.keys(question.criteria);
        const logits = options.map((o) =>
          ruled && typeof ruled === "object" && !Array.isArray(ruled)
            ? (ruled[o] ?? -10)
            : overlap(stateWords, words(`${o} ${question.criteria[o]}`)) * temperature,
        );
        return choiceAnswer(options, softmax(logits));
      }
      case "score": {
        const logits = Array.isArray(ruled)
          ? question.criteria.map((_, i) => ruled[i] ?? -10)
          : question.criteria.map((level) => overlap(stateWords, words(level)) * temperature);
        return scoreAnswer(softmax(logits));
      }
      case "noul":
        return { type: "noul", noul: typeof ruled === "number" ? ruled : 0.5 };
    }
  }
}

const STOP = new Set(["the", "a", "an", "of", "to", "and", "or", "is", "it", "in", "on", "at", "for", "with", "you", "your", "this", "that", "be", "are"]);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of b) if (a.has(w)) n += 1;
  return b.size ? n / Math.sqrt(b.size) : 0;
}
