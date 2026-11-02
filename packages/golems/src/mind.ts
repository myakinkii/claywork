import type { Archetype, DecisionPoint, GameEvent, Id, Option, Role, Thing, World } from "@claywork/clay";
import { check } from "@claywork/glyphs";
import { perspective } from "@claywork/slip";
import { the, weaponOf, type Wheel } from "@claywork/wheel";
import { Choice, getChoice, type Reflex } from "@claywork/reflex";
import { parseJson, type Reason } from "@claywork/reason";
import type { Decision, Policy } from "./index.ts";

/**
 * Minds: what a golem perceives, rendered from its own point of view in roles.
 *
 * Nine rounds of probes against a System One model taught us what it needs:
 *  - facts as sentences with a role subject ("You are badly hurt", "Your foe Anna is fine");
 *  - alerts that appear only when true, for facts not otherwise in words ("You are trapped");
 *  - events re-rendered per observer ("Your foe Anna attacks your master, the Clay Warden");
 *  - attention: only events that involve its roles, speech only from roles it hears;
 *  - options that mean their behavior, in the goal's own words ("Run away", "Attack your foe");
 *  - constraints in structure (forbidden moves are never offered), not in prose;
 *  - think only when something it attends to has happened: with no trigger, the model does
 *    not shrug, it acts on its priors.
 * Nothing here decides what the golem does. The model chooses; code only perceives.
 */

// --- roles ---------------------------------------------------------------------------

export function factionOf(world: World, id: Id, depth = 0): string {
  const a = world.has(id) ? world.get(id).traits.actor : undefined;
  if (!a) return "none";
  if (a.faction) return a.faction;
  if (a.serves && depth < 5 && world.has(a.serves)) return factionOf(world, a.serves, depth + 1);
  return a.kind === "player" ? "players" : "wild";
}

export function roleOf(world: World, observer: Id, other: Id): Role {
  if (other === observer) return "self";
  if (!world.has(other) || !world.get(other).traits.actor) return "other";
  const me = world.get(observer).traits.actor;
  const them = world.get(other).traits.actor!;
  if (me?.serves === other) return "master";
  if (them.serves === observer) return "servant";
  return factionOf(world, observer) === factionOf(world, other) ? "ally" : "foe";
}

const ROLE_WORD: Partial<Record<Role, string>> = { master: "your master", servant: "your servant", ally: "your ally", foe: "your foe" };

/** "you", "your foe Anna", "your master, the Clay Warden", "the iron door". */
export function describe(world: World, observer: Id, id: Id): string {
  const role = roleOf(world, observer, id);
  if (role === "self") return "you";
  const thing = world.get(id);
  const name = (thing.traits.actor?.called as string | undefined) ?? the(thing);
  const word = ROLE_WORD[role];
  if (!word) return name;
  return name.startsWith("the ") ? `${word}, ${name},` : `${word} ${name}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A sentence: capitalized, no dangling comma before the full stop. */
const sentence = (s: string) => cap(s).replace(/,([.!:?])/g, "$1").replace(/,,/g, ",");
const verb = (subject: string, base: string) => (subject === "you" ? base : base.endsWith("s") ? `${base}es` : `${base}s`);

// --- health and conditions -----------------------------------------------------------

/** The engine's health vocabulary: fine (above 2/3), hurt, badly hurt (1/3 or less). */
export function healthWord(hp: number, max: number): "fine" | "hurt" | "badly hurt" {
  return hp * 3 > max * 2 ? "fine" : hp * 3 <= max ? "badly hurt" : "hurt";
}

function conditionOf(world: World, observer: Id, id: Id): string {
  const t = world.get(id);
  const subject = describe(world, observer, id);
  const be = subject === "you" ? "are" : "is";
  const v = t.traits.vitals;
  if (v && v.hp <= 0) return sentence(`${subject} ${be} dead.`);
  const health = v ? ` ${be} ${healthWord(v.hp, v.maxHp)} (${v.hp} of ${v.maxHp}).` : ".";
  const weapon = weaponOf(world, id).thing;
  const name = (t.traits.actor?.called as string | undefined) ?? the(t);
  const hold = subject === "you" ? "You hold" : `${cap(name)} holds`;
  return `${sentence(`${subject}${health}`)} ${hold} ${weapon ? the(weapon) : "nothing"}.`;
}

// --- events, from the observer's point of view ------------------------------------------

/** Re-render an event for an observer, in roles. Unknown events fall back to their own text. */
export function frame(world: World, observer: Id, e: GameEvent): string {
  const who = (id: Id | undefined) => (id && world.has(id) ? describe(world, observer, id) : "someone");
  switch (e.name) {
    case "attacked": {
      const s = who(e.actor);
      const weapon = typeof e.data?.weapon === "string" ? `${s === "you" ? "your" : "the"} ${e.data.weapon}` : "bare hands";
      const damage = typeof e.data?.damage === "number" ? ` (${e.data.damage} damage)` : "";
      return sentence(`${s} ${verb(s, "attack")} ${who(e.target)} with ${weapon}${damage}.`);
    }
    case "died": {
      const by = typeof e.data?.by === "string" ? e.data.by : undefined;
      if (by) {
        const s = who(by);
        return sentence(`${s} ${verb(s, "kill")} ${who(e.target)}.`);
      }
      const s = who(e.target);
      return sentence(`${s} ${verb(s, "die")}.`);
    }
    case "said": {
      const s = who(e.actor);
      return sentence(`${s} ${verb(s, "say")}: "${String(e.data?.words ?? "")}"`);
    }
    case "entered": {
      const s = who(e.actor);
      return sentence(`${s} ${verb(s, "arrive")}.`);
    }
    case "left": {
      const s = who(e.actor);
      return sentence(`${s} ${verb(s, "leave")}.`);
    }
    case "emoted": {
      // free text can't be conjugated: always third person, with the actor described by role
      const name = e.actor === observer ? cap(the(world.get(observer))) : cap(who(e.actor));
      return sentence(`${name} ${String(e.data?.words ?? "")}.`);
    }
    default: {
      // a world verb keeps its template ("{Actor} pets {target}."): fill it in roles
      const template = typeof e.data?.template === "string" ? e.data.template : undefined;
      if (template) {
        return sentence(template.replace(/\{(actor|Actor|target|Target)\}/g, (_m, key: string) => who(key.toLowerCase() === "actor" ? e.actor : e.target)));
      }
      return perspective(e, observer);
    }
  }
}

// --- attention ---------------------------------------------------------------------------

const ROLES_THAT_MATTER = new Set<Role>(["self", "master", "servant", "ally", "foe"]);

/**
 * What a golem notices among the events it perceived: anything involving one of its roles,
 * and speech only from roles it hears (others "shout something"). Returns rendered lines.
 */
export function noticed(world: World, observer: Id, events: GameEvent[], archetype: Archetype): { tick: number; line: string }[] {
  const out: { tick: number; line: string }[] = [];
  for (const e of events) {
    if (e.name === "narration" || e.name === "overheard") {
      out.push({ tick: e.tick, line: e.text });
      continue;
    }
    const involved = [e.actor, e.target, typeof e.data?.by === "string" ? e.data.by : undefined]
      .filter((x): x is Id => typeof x === "string" && world.has(x))
      .map((x) => roleOf(world, observer, x));
    if (!involved.some((r) => ROLES_THAT_MATTER.has(r))) continue;
    if (e.name === "said") {
      if (e.actor === observer) continue;
      const speaker = e.actor ? roleOf(world, observer, e.actor) : "other";
      if (archetype.hears && !archetype.hears.includes(speaker)) {
        const s = describe(world, observer, e.actor!);
        out.push({ tick: e.tick, line: sentence(`${s} ${verb(s, "shout")} something.`) });
        continue;
      }
    }
    out.push({ tick: e.tick, line: frame(world, observer, e) });
  }
  return out;
}

// --- the mind's state and options ----------------------------------------------------------

export interface MindView {
  phase: string;
  state: Record<string, unknown>;
  /** option id -> description, the only choices the model sees. */
  criteria: Record<string, string>;
  /** The decision point restricted to those choices, for fallbacks. */
  options: Option[];
}

function master(world: World, self: Id): Id | undefined {
  const m = world.get(self).traits.actor?.serves;
  return m && world.has(m) ? m : undefined;
}

export function currentPhase(world: World, self: Id, archetype: Archetype): Archetype["phases"][number] {
  const m = master(world, self);
  const ctx = { world, actor: self, self, ...(m ? { master: m } : {}) };
  return archetype.phases.find((p) => !p.when || check(p.when, ctx)) ?? archetype.phases[archetype.phases.length - 1]!;
}

function describeOption(world: World, self: Id, o: Option): string {
  const t = o.intent.target && world.has(o.intent.target) ? world.get(o.intent.target) : undefined;
  switch (o.intent.verb) {
    case "attack":
      return t ? sentence(`attack ${describe(world, self, t.id)}.`) : o.hint;
    case "go": {
      if (!t) return o.hint;
      const dir = t.traits.exit?.direction;
      const way = dir === "up" || dir === "down" ? `${dir} ${the(t)}` : dir ? `${dir} through ${the(t)}` : `through ${the(t)}`;
      return `Run away ${way}.`;
    }
    case "wait":
      return "Stay where you are.";
    default:
      return o.hint;
  }
}

/**
 * Orders: the last words a golem heard from a role it listens to ("hears"). Unlike other
 * events they don't scroll away in a busy fight: they stand until superseded.
 */
export function orders(wheel: Wheel, self: Id, archetype: Archetype) {
  let last: string | undefined;
  const unsubscribe = archetype.hears?.length
    ? wheel.slip.subscribe((e) => {
        if (e.name !== "said" || !e.actor || e.actor === self || !wheel.world.has(e.actor)) return;
        if (archetype.hears!.includes(roleOf(wheel.world, self, e.actor))) last = frame(wheel.world, self, e);
      }, { actor: self })
    : () => {};
  return { current: () => last, stop: unsubscribe };
}

/** Everything the decision model sees for one golem, built from the world right now. */
export function mindView(wheel: Wheel, self: Id, archetype: Archetype, dp: DecisionPoint, extras: { heard?: string } = {}): MindView {
  const { world } = wheel;
  const phase = currentPhase(world, self, archetype);
  const m = master(world, self);

  // choices: legal options, in repertoire, minus forbidden verb:role pairs
  const forbidden = new Set(archetype.forbid ?? []);
  const options = dp.options.filter((o) => {
    if (!archetype.repertoire.includes(o.intent.verb)) return false;
    const target = o.intent.target;
    if (target && world.get(target).traits.actor && forbidden.has(`${o.intent.verb}:${roleOf(world, self, target)}`)) return false;
    return true;
  });
  const criteria = Object.fromEntries(options.map((o) => [o.id, describeOption(world, self, o)]));

  // who is around, by role
  const around = world.perceivable(self).filter((t: Thing) => t.traits.actor && t.id !== self);
  const foes = around.filter((t) => roleOf(world, self, t.id) === "foe" && world.isAlive(t.id));
  const allies = around.filter((t) => ["ally", "servant"].includes(roleOf(world, self, t.id)) && world.isAlive(t.id));

  // alerts: only what is true right now
  const alerts: string[] = [];
  const v = world.get(self).traits.vitals;
  if (v && healthWord(v.hp, v.maxHp) === "badly hurt") alerts.push("You are badly hurt!");
  for (const f of foes) {
    const fv = f.traits.vitals;
    if (fv && healthWord(fv.hp, fv.maxHp) === "badly hurt") alerts.push(sentence(`${describe(world, self, f.id)} is badly hurt!`));
  }
  if (m) {
    const mv = world.get(m).traits.vitals;
    if (!world.isAlive(m)) alerts.push("Your master is dead!");
    else if (mv && healthWord(mv.hp, mv.maxHp) === "badly hurt") alerts.push("Your master is badly hurt!");
  }
  // "trapped" as an alert AND a fact: round 9 measured 0.32 -> 0.57 for the cornered goblin
  const trapped = archetype.repertoire.includes("go") && !dp.options.some((o) => o.intent.verb === "go");
  if (trapped) alerts.push("You are trapped: there is nowhere to run!");

  const memory = archetype.memory ?? 4;
  const lines = noticed(world, self, wheel.slip.recent(self, 20), archetype).slice(-memory).map((n) => n.line);

  const state: Record<string, unknown> = {
    persona: archetype.persona,
    goal: phase.goal,
    you: `${conditionOf(world, self, self)}${trapped ? " You are trapped: there is no way out." : ""}`,
    ...(m ? { master: conditionOf(world, self, m) } : {}),
    ...(foes.length ? { foes: foes.map((f) => conditionOf(world, self, f.id)) } : {}),
    ...(allies.length ? { allies: allies.map((a) => conditionOf(world, self, a.id)) } : {}),
    ...(alerts.length ? { alerts } : {}),
    ...(extras.heard ? { heard: extras.heard } : {}),
    noticed: lines,
  };
  return { phase: phase.id, state, criteria, options };
}

// --- modes: battle (fast mind, moves) and calm (slow mind, expression) -------------------------

/** How many ticks an attack stays "recent" for the mode switch. */
export const BATTLE_COOLDOWN = 3;

/**
 * The creature's mode, decided by the situation, never by a model: battle while a living
 * foe is in reach, or while an attack it noticed is recent; otherwise calm. Creatures
 * without a calm section are always in battle mode.
 */
export function modeOf(wheel: Wheel, self: Id, archetype: Archetype): "battle" | "calm" {
  if (!archetype.calm) return "battle";
  const { world } = wheel;
  const foeInReach = world.perceivable(self).some((t) => t.traits.actor && world.isAlive(t.id) && roleOf(world, self, t.id) === "foe");
  if (foeInReach) return "battle";
  const recentAttack = wheel.slip.recent(self, 20).some((e) => (e.name === "attacked" || e.name === "died") && e.tick > wheel.tick - BATTLE_COOLDOWN);
  return recentAttack ? "battle" : "calm";
}

const CALM_FORMAT = [
  "Answer with JSON only, exactly one of:",
  '{"do": "emote", "text": "..."}   an action in the third person present tense, without your name, e.g. "wags its tail"',
  '{"do": "say", "text": "..."}     words you say out loud',
  '{"do": "nothing"}',
].join("\n");

/** The slow mind's instructions: persona, calm goal, and the one thing it may do: express itself. */
export function calmSystem(world: World, self: Id, archetype: Archetype, options: { idle?: boolean } = {}): string {
  return [
    `You are ${the(world.get(self))}, a creature in a text adventure.`,
    `Persona: ${archetype.persona}`,
    `There is no danger right now. ${archetype.calm!.goal}`,
    ...(options.idle ? ["Nothing new has happened for a while and nobody is paying attention to you: you may mutter to yourself about what is on your mind."] : []),
    "You only express yourself here: never claim to attack, take, open or move anything.",
    "Keep it to one short sentence, in character. Often the best answer is a small gesture.",
    CALM_FORMAT,
  ].join("\n");
}

export type Expression = { verb: "emote" | "say"; text: string } | null;

/**
 * Validate what the slow mind said. Anything malformed becomes nothing: the engine never
 * guesses what a model meant.
 */
export function expression(raw: string, name: string): Expression {
  let parsed: unknown;
  try {
    parsed = parseJson(raw);
  } catch {
    return null;
  }
  const o = parsed as { do?: unknown; text?: unknown };
  if (o.do !== "emote" && o.do !== "say") return null;
  if (typeof o.text !== "string") return null;
  let text = o.text.replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "");
  if (o.do === "emote") {
    // "Pebble wags its tail." -> "wags its tail": the engine adds the name itself
    for (const lead of [`the ${name}`, name]) {
      if (text.toLowerCase().startsWith(lead.toLowerCase()) && /[\s,]/.test(text.charAt(lead.length))) {
        text = text.slice(lead.length).replace(/^[\s,]+/, "");
        break;
      }
    }
    text = text.replace(/[.!]+$/, "");
  }
  if (!text || text.length > 160) return null;
  return { verb: o.do, text };
}

/** One calm thought: the role-framed view in, at most one expression out. */
export async function calmThink(
  wheel: Wheel,
  self: Id,
  archetype: Archetype,
  reason: Reason,
  options: { signal?: AbortSignal; heard?: string; idle?: boolean } = {},
): Promise<{ expression: Expression; raw: string; state: Record<string, unknown> }> {
  const dp = wheel.decisionPoint(self);
  const view = mindView(wheel, self, archetype, dp, options.heard ? { heard: options.heard } : {});
  const state: Record<string, unknown> = { ...view.state, goal: archetype.calm!.goal };
  delete state.alerts;
  // its own last expressions, so it doesn't repeat itself (they never wake it: see attentive)
  const recently = wheel.slip
    .recent(self, 20)
    .filter((e) => e.actor === self && (e.name === "emoted" || e.name === "said"))
    .slice(-2)
    .map((e) => e.text);
  if (recently.length) state.you_recently = recently;
  const res = await reason.complete(
    { system: calmSystem(wheel.world, self, archetype, { idle: options.idle ?? false }), messages: [{ role: "user", content: JSON.stringify(state) }], maxTokens: 120 },
    options.signal ? { signal: options.signal } : {},
  );
  return { expression: expression(res.text, wheel.world.get(self).name), raw: res.text, state };
}

// --- when to think ---------------------------------------------------------------------------

/**
 * Attention decides WHEN a golem thinks: only when something it attends to happened since
 * its last thought (or its phase changed). Otherwise it doesn't call the model at all.
 */
export function attentive(wheel: Wheel, self: Id, archetype: Archetype) {
  let last = -1;
  let lastSituation: string | undefined;
  const situation = () => `${currentPhase(wheel.world, self, archetype).id}/${modeOf(wheel, self, archetype)}`;
  // A golem's own words and gestures never wake it: otherwise every emote would beget another.
  const ownExpression = (e: GameEvent) => e.actor === self && (e.name === "emoted" || e.name === "said");
  return {
    wants(): boolean {
      if (!wheel.world.has(self) || !wheel.world.isAlive(self)) return false;
      if (situation() !== lastSituation) return true;
      const events = wheel.slip.recent(self, 20).filter((e) => !ownExpression(e));
      return noticed(wheel.world, self, events, archetype).some((n) => n.tick > last);
    },
    thought(): void {
      last = wheel.tick;
      lastSituation = situation();
    },
  };
}

// --- the policy ---------------------------------------------------------------------------------

export interface MindOptions {
  fallback?: Policy;
  /** Below this confidence the engine acts on the fallback instead. Default 0.4. */
  trust?: number;
  /** Seen after each decision: the exact state and choices sent, for debugging and probes. */
  onView?: (view: MindView) => void;
  /** Standing orders, from orders(). */
  heard?: () => string | undefined;
}

const INSTRUCTIONS = "You are the creature described in the state. What do you do next?";

/** The one question a mind asks, shared by the policy and by test tiles so they never drift apart. */
export function mindQuestion(view: MindView) {
  return { action: Choice(INSTRUCTIONS, view.criteria) };
}

/** Any policy, held to the archetype's repertoire and forbidden moves: for fallback paths. */
export function restricted(wheel: Wheel, archetype: Archetype, policy: Policy): Policy {
  return {
    name: policy.name,
    decide: (dp, signal) => policy.decide({ ...dp, options: mindView(wheel, dp.actor, archetype, dp).options }, signal),
  };
}

/**
 * A golem that thinks with an archetype: one Choice question over its own, role-framed
 * options. The fallback (if unsure) only ever sees the same restricted options.
 */
export function mindPolicy(wheel: Wheel, reflex: Reflex, archetype: Archetype, options: MindOptions = {}): Policy {
  const trust = options.trust ?? 0.4;
  return {
    name: `mind(${reflex.name})`,
    async decide(dp, signal): Promise<Decision> {
      const heard = options.heard?.();
      const view = mindView(wheel, dp.actor, archetype, dp, heard ? { heard } : {});
      options.onView?.(view);
      const restricted: DecisionPoint = { ...dp, options: view.options };
      if (view.options.length === 0) return { option: dp.options.find((o) => o.intent.verb === "wait")?.id ?? "wait", why: "nothing in repertoire" };
      if (view.options.length === 1) return { option: view.options[0]!.id, why: "only one choice" };
      const res = await reflex.ask({ state: view.state, questions: mindQuestion(view) }, { signal });
      const action = getChoice(res, "action");
      const signals: Record<string, number> = { confidence: action.confidence };
      if (res.inputTokens !== undefined) signals.tokens = res.inputTokens;
      if (action.confidence < trust && options.fallback) {
        const fb = await options.fallback.decide(restricted, signal);
        return { ...fb, why: `${view.phase}: unsure (${action.confidence.toFixed(2)}), ${options.fallback.name}: ${fb.why ?? ""}`, signals };
      }
      return { option: action.choice, why: `${view.phase} (${action.confidence.toFixed(2)})`, signals };
    },
  };
}
