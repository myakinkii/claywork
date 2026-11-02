import type { DecisionPoint, GameEvent, Id, Option, Thing } from "@claywork/clay";
import { attentive, mindPolicy, orders, restricted, type MindOptions } from "./mind.ts";
import { Choice, Noul, Score, getChoice, getNoul, getScore, type Reflex } from "@claywork/reflex";
import type { Reason } from "@claywork/reason";
import type { Wheel } from "@claywork/wheel";

/**
 * Golems: clay figures brought to life.
 *
 * A golem's mind is a Policy: decision point in, chosen option out. Humans, rules,
 * System One models and LLM agents (ADK or otherwise) all fit the same contract, so
 * the engine never knows or cares who is choosing.
 */

export interface Decision {
  option: string;
  /** Why, for logs and debugging. */
  why?: string;
  /** Extra signals the policy measured (danger, confidence...). */
  signals?: Record<string, number>;
}

export interface Policy {
  readonly name: string;
  decide(dp: DecisionPoint, signal: AbortSignal): Promise<Decision>;
}

// --- rule policies: instant, free, deterministic -------------------------------

export function rulePolicy(name: string, fn: (dp: DecisionPoint) => Decision): Policy {
  return { name, decide: async (dp) => fn(dp) };
}

const find = (dp: DecisionPoint, verb: string): Option | undefined => dp.options.find((o) => o.intent.verb === verb);
const fallbackOption = (dp: DecisionPoint): string => find(dp, "wait")?.id ?? dp.options[0]?.id ?? "wait";

export const idle = rulePolicy("idle", (dp) => ({ option: fallbackOption(dp), why: "idle" }));

/**
 * A simple fighter: flee when badly hurt, otherwise attack anyone in reach, otherwise wait.
 * Used as the fallback when a model is too slow or too unsure.
 */
export function brute(options: { fleeBelow?: number } = {}): Policy {
  const fleeBelow = options.fleeBelow ?? 0.25;
  return rulePolicy("brute", (dp) => {
    const vitals = dp.observation.self.state.find((s) => s.startsWith("hp "));
    const [hp, max] = vitals ? vitals.slice(3).split("/").map(Number) : [1, 1];
    const flee = find(dp, "go");
    if (flee && hp! / max! < fleeBelow) return { option: flee.id, why: "badly hurt" };
    const attack = find(dp, "attack");
    if (attack) return { option: attack.id, why: "enemy in reach" };
    return { option: fallbackOption(dp), why: "nothing to do" };
  });
}

// --- the System One policy -------------------------------------------------------

export interface ReflexThresholds {
  /** Below this confidence the answer is a guess: use the fallback policy. */
  trust: number;
  /** Danger score (0 none, 1 some, 2 mortal) at or above which a shaky golem flees. */
  panic: number;
}

/**
 * Ask a System One model to pick among the legal options, codelab style:
 * one request per decision, three questions, deterministic thresholds in code.
 * The model provides probabilities; the code decides what to trust.
 */
export function reflexPolicy(reflex: Reflex, options: { fallback?: Policy; thresholds?: Partial<ReflexThresholds> } = {}): Policy {
  const fallback = options.fallback ?? brute();
  const t: ReflexThresholds = { trust: 0.4, panic: 1.5, ...options.thresholds };
  return {
    name: `reflex(${reflex.name})`,
    async decide(dp, signal) {
      if (dp.options.length === 0) return { option: "wait", why: "no options" };
      const obs = dp.observation;
      const res = await reflex.ask(
        {
          state: {
            persona: dp.persona,
            goal: dp.goal,
            self: { name: obs.self.name, state: obs.self.state, carrying: obs.self.carrying.map((c) => c.name) },
            room: obs.room.title,
            visible: obs.visible.map((v) => `${v.name}${v.state.length ? ` (${v.state.join(", ")})` : ""}`),
            recent: obs.recent,
          },
          questions: {
            action: Choice(
              "Given your persona, goal and situation, what do you do next?",
              Object.fromEntries(dp.options.map((o) => [o.id, o.hint])),
            ),
            danger: Score("How much danger are you in right now?", ["No threat.", "Some threat.", "Mortal danger."]),
            deliberate: Noul("Does this moment call for careful thought or conversation rather than a reflex?"),
          },
        },
        { signal },
      );
      const action = getChoice(res, "action");
      const danger = getScore(res, "danger").score;
      const signals: Record<string, number> = { confidence: action.confidence, danger, deliberate: getNoul(res, "deliberate").noul };
      if (res.inputTokens !== undefined) signals.tokens = res.inputTokens;

      if (action.confidence < t.trust) {
        const flee = danger >= t.panic ? find(dp, "go") : undefined;
        if (flee) return { option: flee.id, why: "unsure and in mortal danger", signals };
        const fb = await fallback.decide(dp, signal);
        return { ...fb, why: `unsure (${action.confidence.toFixed(2)}), ${fallback.name}: ${fb.why ?? ""}`, signals };
      }
      return { option: action.choice, why: `reflex (${action.confidence.toFixed(2)})`, signals };
    },
  };
}

// --- animation: binding a mind to a body on the wheel ---------------------------

export interface Animated {
  readonly actor: Id;
  readonly stats: { decisions: number; timeouts: number; errors: number; fallbacks: number };
  stop(): void;
}

export interface AnimateOptions {
  policy: Policy;
  /** Used when the policy misses its deadline, errors, or picks an illegal option. */
  fallback?: Policy;
  /** The wheel never waits: a decision must arrive within this budget. Default 800ms. */
  deadlineMs?: number;
  /** Called with every decision, for logs and dashboards. */
  onDecision?: (d: Decision & { actor: Id; tick: number; source: string; ms: number }) => void;
  /** When this says false, the golem doesn't think at all this tick: no model call, no intent. */
  awake?: () => boolean;
}

/**
 * Bind a policy to an actor. After every turn (if it isn't already thinking) the golem
 * takes a decision point, races its policy against the deadline, and submits the
 * chosen intent, which the wheel resolves on a later turn.
 */
export function animate(wheel: Wheel, actor: Id, options: AnimateOptions): Animated {
  const fallback = options.fallback ?? idle;
  const deadline = options.deadlineMs ?? 800;
  const stats = { decisions: 0, timeouts: 0, errors: 0, fallbacks: 0 };
  let thinking = false;

  const think = async () => {
    if (thinking || !wheel.world.has(actor) || !wheel.world.isAlive(actor)) return;
    if (options.awake && !options.awake()) return;
    thinking = true;
    const started = Date.now();
    const tick = wheel.tick;
    const dp = wheel.decisionPoint(actor);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("deadline")), deadline);
    let decision: Decision;
    let source = options.policy.name;
    try {
      decision = await options.policy.decide(dp, controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!dp.options.some((o) => o.id === decision.option)) throw new Error(`illegal option "${decision.option}"`);
    } catch (e) {
      if (controller.signal.aborted) stats.timeouts += 1;
      else stats.errors += 1;
      stats.fallbacks += 1;
      source = fallback.name;
      decision = { ...(await fallback.decide(dp, new AbortController().signal)), why: `fallback: ${(e as Error).message}` };
    } finally {
      clearTimeout(timer);
    }
    stats.decisions += 1;
    const chosen = dp.options.find((o) => o.id === decision.option);
    if (chosen && wheel.world.isAlive(actor)) wheel.submit(chosen.intent);
    options.onDecision?.({ ...decision, actor, tick, source, ms: Date.now() - started });
    thinking = false;
  };

  const unsubscribe = wheel.onTurn(() => void think());
  return { actor, stats, stop: unsubscribe };
}

// --- voice: the slow, System Two side --------------------------------------------

export interface VoiceOptions {
  /** How many lines of conversation are remembered. */
  memory?: number;
  /** Talk to itself every N ticks, whether anyone is there to hear or not. */
  mutter?: { everyTicks: number; prompt?: string };
}

/** The instruction sent when a golem mutters; scripts and fakes can recognize it. */
export const MUTTER = "(Nobody is talking to you. Mutter one short line to yourself about what is on your mind.)";

/**
 * Give a golem a voice. When someone else speaks in its presence it answers in
 * character, and with `mutter` it also talks to itself now and then: fuel for anyone
 * listening through a wall. Runs at its own pace, never blocking the wheel.
 */
export function voice(wheel: Wheel, actor: Id, reason: Reason, options: VoiceOptions = {}): Animated {
  const stats = { decisions: 0, timeouts: 0, errors: 0, fallbacks: 0 };
  const history: { role: "user" | "assistant"; content: string }[] = [];
  const memory = options.memory ?? 12;
  let speaking = false;

  const speak = async (prompt: { role: "user"; content: string }, remember: boolean) => {
    if (speaking || !wheel.world.has(actor) || !wheel.world.isAlive(actor)) return;
    speaking = true;
    if (remember) history.push(prompt);
    const me = wheel.world.get(actor);
    const traits = me.traits.actor;
    try {
      const obs = wheel.observe(actor);
      const res = await reason.complete({
        system: [
          `You are ${me.name} in a text adventure. ${me.description ?? ""}`,
          traits?.persona ? `Persona: ${traits.persona}` : "",
          traits?.goal ? `Goal: ${traits.goal}` : "",
          `You are in: ${obs.room.title}. You see: ${obs.visible.map((v) => v.name).join(", ") || "nothing"}.`,
          "Reply with one short line of speech only, in character. No narration, no quotes.",
        ].filter(Boolean).join("\n"),
        messages: remember ? history.slice(-memory) : [...history.slice(-memory), prompt],
      });
      const line = res.text.trim().replace(/^"|"$/g, "");
      if (line) history.push({ role: "assistant", content: line });
      stats.decisions += 1;
      if (line && wheel.world.isAlive(actor)) wheel.submit({ actor, verb: "say", text: line });
    } catch {
      stats.errors += 1;
    } finally {
      speaking = false;
    }
  };

  const unsubscribe = wheel.slip.subscribe((event) => {
    if (event.name === "said" && event.actor !== actor) void speak({ role: "user", content: event.text }, true);
  }, { actor });

  const mutter = options.mutter;
  const unturn = mutter
    ? wheel.onTurn(() => {
        if (wheel.tick % mutter.everyTicks === 0) void speak({ role: "user", content: mutter.prompt ?? MUTTER }, false);
      })
    : () => {};

  return {
    actor,
    stats,
    stop: () => {
      unsubscribe();
      unturn();
    },
  };
}

// --- awakening: every inhabitant of a world at once ---------------------------------

/** The minds a world's inhabitants think with. Any of them may be missing. */
export interface Minds {
  reflex?: Reflex;
  reason?: Reason;
  /** Voices mutter every N ticks. Omit for golems that only answer. */
  mutterEvery?: number;
  /** Decision budget per tick, in ms. Default 800. */
  deadlineMs?: number;
}

/** True when a living player shares the actor's room: someone to act for. */
export function playerNearby(wheel: Wheel, actor: Id): boolean {
  const room = wheel.world.roomOf(actor);
  if (!room) return false;
  for (const t of wheel.world.things.values()) {
    if (t.traits.actor?.kind === "player" && !t.traits.linkdead && wheel.world.isAlive(t.id) && wheel.world.roomOf(t.id) === room) return true;
  }
  return false;
}

/**
 * Bring every mob and npc in a world to life, including ones that appear later (a player's
 * companion). Golems with an archetype think with a mind (role-framed perception, attention
 * decides when to think); others use the older reflex policy. Without a reflex model, rules.
 * All are dormant unless a player is in the room. Voices only for golems without an
 * archetype, so speech never crowds out a mind's actions.
 * Returns the (growing) list of handles so the caller can stop them all.
 */
export function awaken(wheel: Wheel, minds: Minds = {}, options: Pick<AnimateOptions, "onDecision"> & Pick<MindOptions, "onView"> = {}): Animated[] {
  const handles: Animated[] = [];
  const animated = new Set<Id>();
  const bring = (thing: Thing) => {
    const kind = thing.traits.actor?.kind;
    if ((kind !== "mob" && kind !== "npc") || animated.has(thing.id) || thing.location === null) return;
    animated.add(thing.id);
    const archetype = thing.traits.actor?.archetype ? wheel.scenario.archetypes?.[thing.traits.actor.archetype] : undefined;
    const common = {
      fallback: brute(),
      deadlineMs: minds.deadlineMs ?? 800,
      ...(options.onDecision ? { onDecision: options.onDecision } : {}),
    };
    if (archetype) {
      const attention = attentive(wheel, thing.id, archetype);
      const heard = orders(wheel, thing.id, archetype);
      // Constraints hold on every path: the mind, its unsure fallback, and the timeout fallback.
      const safeBrute = restricted(wheel, archetype, brute());
      const mind = minds.reflex
        ? mindPolicy(wheel, minds.reflex, archetype, { fallback: safeBrute, heard: heard.current, ...(options.onView ? { onView: options.onView } : {}) })
        : safeBrute;
      const policy: Policy = {
        name: mind.name,
        decide: async (dp, signal) => {
          attention.thought();
          return mind.decide(dp, signal);
        },
      };
      const animated = animate(wheel, thing.id, { ...common, fallback: safeBrute, policy, awake: () => playerNearby(wheel, thing.id) && attention.wants() });
      handles.push({ ...animated, stop: () => (animated.stop(), heard.stop()) });
      return;
    }
    const policy = minds.reflex ? reflexPolicy(minds.reflex, { fallback: brute() }) : brute();
    handles.push(animate(wheel, thing.id, { ...common, policy, awake: () => playerNearby(wheel, thing.id) }));
    if (minds.reason) {
      handles.push(voice(wheel, thing.id, minds.reason, minds.mutterEvery ? { mutter: { everyTicks: minds.mutterEvery } } : {}));
    }
  };
  for (const thing of wheel.world.things.values()) bring(thing);
  const newcomers = wheel.onTurn(() => {
    for (const thing of wheel.world.things.values()) bring(thing);
  });
  handles.push({ actor: "*", stats: { decisions: 0, timeouts: 0, errors: 0, fallbacks: 0 }, stop: newcomers });
  return handles;
}

export { attentive, currentPhase, describe, factionOf, frame, healthWord, mindPolicy, mindQuestion, mindView, noticed, orders, restricted, roleOf, type MindOptions, type MindView } from "./mind.ts";
