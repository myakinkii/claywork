import { World } from "@claywork/clay";
import type { DecisionPoint, EventDraft, GameEvent, Id, Intent, Observation, Option, Requirement, Scenario, Thing } from "@claywork/clay";
import { fire, check } from "@claywork/glyphs";
import { Slip, perspective } from "@claywork/slip";
import { standardVerbs, type Verb } from "./verbs.ts";
import { redescribe, worldVerb } from "./world-verbs.ts";
import { STILL_VERBS, overhear, sight } from "./senses.ts";
import { pickArt } from "@claywork/glyphs";

/** How an intent turned out, for simulations and tests. */
export type Outcome = "done" | "failed" | "unable" | "blocked" | "stale";

export interface WheelOptions {
  verbs?: Verb[];
  /** How many perceived events an actor remembers for its observations. */
  memory?: number;
}

export interface Player {
  id: Id;
  name: string;
  description?: string;
  hp?: number;
}

/**
 * The wheel never stops: it turns at a fixed rate whether anyone acts or not.
 * Each turn it resolves queued intents in submission order (one per actor per turn),
 * runs glyph triggers around each verb, publishes events and notifies listeners.
 * It is the single authority over the world: nothing else mutates it.
 */
export class Wheel {
  readonly world: World;
  readonly slip: Slip;
  readonly scenario: Scenario;
  tick = 0;

  readonly #verbs = new Map<string, Verb>();
  readonly #requirements = new Map<string, Requirement[]>();
  readonly #outcomes = new Map<Id, Outcome>();
  readonly #queue = new Map<Id, Intent>();
  readonly #fired = new Set<string>();
  readonly #turnListeners = new Set<(events: GameEvent[]) => void>();
  readonly #submitListeners = new Set<(intent: Intent) => void>();
  readonly #won = new Set<Id>();
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(scenario: Scenario, options: WheelOptions = {}) {
    this.scenario = scenario;
    this.world = new World(scenario);
    this.slip = new Slip((id) => (this.world.has(id) ? this.world.roomOf(id) : null), {
      memory: options.memory ?? 20,
      overhear: overhear(this.world),
      adapt: sight(this.world),
    });
    for (const verb of options.verbs ?? standardVerbs) this.#verbs.set(verb.name, { origin: "engine", ...verb });
    for (const [name, config] of Object.entries(scenario.verbs ?? {})) {
      const base = this.#verbs.get(name);
      if (config === false) {
        if (name === "wait") throw new Error(`"wait" cannot be switched off: it is the floor every decision stands on`);
        this.#verbs.delete(name);
        continue;
      }
      this.#verbs.set(name, base ? redescribe(base, config) : worldVerb(name, config));
      if (config.requires?.length) this.#requirements.set(name, config.requires);
    }
    for (const thing of this.world.things.values()) if (thing.traits.actor) this.slip.track(thing.id);
  }

  /** A player joins the running world at the spawn room. */
  join(player: Player): Thing {
    const hp = player.hp ?? this.scenario.player?.hp ?? 20;
    const thing = this.world.add({
      id: player.id,
      name: player.name,
      ...(player.description ? { description: player.description } : {}),
      location: this.scenario.spawn,
      traits: { ...structuredClone(this.scenario.player?.traits ?? {}), actor: { kind: "player" }, vitals: { hp, maxHp: hp } },
    });
    this.slip.track(thing.id);
    this.#publish([
      { name: "entered", scope: { kind: "room", room: this.scenario.spawn }, actor: thing.id, text: `${thing.name} appears.`, you: this.scenario.intro ?? "You arrive." },
    ]);
    // Companions join with the player and serve them; their items come along.
    for (const template of this.scenario.player?.companions ?? []) {
      const { carrying = [], ...body } = structuredClone(template);
      const id = `${thing.id}-${template.id}`;
      const companion = this.world.add({
        ...body,
        id,
        location: this.scenario.spawn,
        traits: { ...body.traits, actor: { ...(body.traits.actor ?? {}), serves: thing.id, companion: true } },
      });
      for (const item of carrying) this.world.add({ ...item, id: `${id}-${item.id}`, location: id });
      this.slip.track(companion.id);
      this.#publish([{ name: "entered", scope: { kind: "room", room: this.scenario.spawn }, actor: id, text: `${companion.name} comes with ${thing.name}.` }]);
    }
    return thing;
  }

  /**
   * A player leaves the world: what they carry falls where they stood, they fade,
   * and their body is moved to nowhere. Their id is never reused.
   */
  leave(actor: Id): void {
    if (!this.world.has(actor)) return;
    for (const t of [...this.world.things.values()]) {
      if (t.traits.actor?.companion && t.traits.actor.serves === actor && t.location !== null) this.leave(t.id);
    }
    const room = this.world.roomOf(actor);
    const who = this.world.get(actor);
    for (const item of this.world.children(actor)) this.world.move(item.id, room);
    this.#queue.delete(actor);
    if (room) {
      this.#publish([{ name: "left", scope: { kind: "room", room }, actor, text: `${who.name} fades away.`, you: "You leave the world." }]);
    }
    this.world.move(actor, null);
  }

  /** Publish something that happened outside the verbs, like a player going link-dead. */
  announce(draft: EventDraft): GameEvent {
    return this.#publish([draft])[0]!;
  }

  /** Queue an intent for the next turn. A newer intent from the same actor replaces the old one. */
  submit(intent: Intent): void {
    this.#queue.delete(intent.actor);
    this.#queue.set(intent.actor, intent);
    for (const fn of this.#submitListeners) fn(intent);
  }

  /** Called with every intent as it is submitted, before it is resolved. */
  onSubmit(fn: (intent: Intent) => void): () => void {
    this.#submitListeners.add(fn);
    return () => this.#submitListeners.delete(fn);
  }

  /** Called after every turn with the events it produced. */
  onTurn(fn: (events: GameEvent[]) => void): () => void {
    this.#turnListeners.add(fn);
    return () => this.#turnListeners.delete(fn);
  }

  /** Advance the world by one tick. */
  turn(): GameEvent[] {
    this.tick += 1;
    const intents = [...this.#queue.values()];
    this.#queue.clear();
    this.#outcomes.clear();
    const produced: GameEvent[] = [];
    for (const intent of intents) produced.push(...this.#publish(this.#resolve(intent)));
    produced.push(...this.#publish(this.#firstSights()));
    produced.push(...this.#publish(this.#checkGoals()));
    for (const fn of [...this.#turnListeners]) fn(produced);
    return produced;
  }

  start(intervalMs = 1000): void {
    this.stop();
    this.#timer = setInterval(() => this.turn(), intervalMs);
  }

  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** Every legal option for an actor right now: the closed set humans and models choose from. */
  options(actor: Id): Option[] {
    if (!this.world.has(actor) || !this.world.isAlive(actor)) return [];
    // Only options that pass their verb's own check: models never waste a choice on
    // something that cannot happen. Glyphs may still block a legal option (that is the story).
    return [...this.#verbs.values()].flatMap((v) =>
      v.options(this.world, actor).filter((o) => v.check({ world: this.world, actor, intent: o.intent }) === null),
    );
  }

  /** The vocabulary of this world: engine verbs it kept, plus verbs it defined. */
  verbs(): Pick<Verb, "name" | "summary" | "usage" | "aliases" | "freeText" | "origin">[] {
    return [...this.#verbs.values()].map(({ name, summary, usage, aliases, freeText, origin }) => ({
      name,
      summary,
      usage,
      origin: origin ?? "engine",
      ...(aliases ? { aliases } : {}),
      ...(freeText ? { freeText } : {}),
    }));
  }

  /** How the actor's intent turned out on the last turn, if it had one. */
  outcome(actor: Id): Outcome | undefined {
    return this.#outcomes.get(actor);
  }

  /** What an actor perceives, ready to render (glaze) or to send to a model (golems). */
  observe(actor: Id): Observation {
    const { world } = this;
    const roomId = world.roomOf(actor);
    if (!roomId) throw new Error(`${actor} is nowhere`);
    const room = world.get(roomId);
    const self = world.seen(actor);
    const dark = !world.canSee(actor);
    const description = dark ? (room.traits.dark?.text ?? "It is too dark to see.") : room.description;
    return {
      tick: this.tick,
      dark,
      self: { ...self, carrying: world.carried(actor).map((t) => world.seen(t.id)) },
      room: { id: room.id, title: room.traits.room?.title ?? room.name, ...(description ? { description } : {}) },
      visible: world.perceivable(actor).map((t) => world.seen(t.id)),
      exits: world.exitsFrom(roomId).map((t) => ({ ...world.seen(t.id), ...(t.traits.exit?.direction ? { direction: t.traits.exit.direction } : {}) })),
      recent: this.slip.recent(actor).map((e) => perspective(e, actor)),
    };
  }

  decisionPoint(actor: Id): DecisionPoint {
    const traits = this.world.get(actor).traits.actor;
    return {
      actor,
      observation: this.observe(actor),
      ...(traits?.persona ? { persona: traits.persona } : {}),
      ...(traits?.goal ? { goal: traits.goal } : {}),
      options: this.options(actor),
    };
  }

  hasWon(actor: Id): boolean {
    return this.#won.has(actor);
  }

  // --- internals -------------------------------------------------------------

  #resolve(intent: Intent): EventDraft[] {
    const { world } = this;
    const actor = intent.actor;
    const say = (name: string, text: string): EventDraft => ({ name, scope: { kind: "actor", actor }, actor, text, you: text });
    const outcome = (o: Outcome, events: EventDraft[]) => {
      this.#outcomes.set(actor, o);
      return events;
    };

    if (!world.has(actor) || !world.isAlive(actor)) return [];
    if (intent.where !== undefined && world.roomOf(actor) !== intent.where) return outcome("stale", []);
    // Doing anything else breaks stillness and attention; wait and listen count stillness up.
    if (!STILL_VERBS.has(intent.verb) && world.get(actor).traits.actor) {
      world.setProp(actor, "actor.still", 0);
      world.setProp(actor, "actor.listening", false);
    }

    const verb = this.#verbs.get(intent.verb);
    if (!verb) return outcome("failed", [say("failed", `You don't know how to ${intent.verb}.`)]);

    // Inability is the world's to describe, and comes before any other problem.
    const glyphCtx = { world, actor, ...(intent.target ? { target: intent.target } : {}) };
    for (const req of this.#requirements.get(verb.name) ?? []) {
      const ok = (!req.if || check(req.if, glyphCtx)) && (!req.unless || !check(req.unless, glyphCtx));
      if (!ok) return outcome("unable", [say("unable", req.fail ?? "You can't do that right now.")]);
    }

    const ctx = { world, actor, intent };
    const problem = verb.check(ctx);
    if (problem) return outcome("failed", [say("failed", problem)]);

    const triggers = this.scenario.triggers ?? [];
    const before = fire(triggers, { on: verb.name, phase: "before" }, glyphCtx, this.#fired);
    if (before.blocked) return outcome("blocked", before.events);

    const performed = verb.perform(ctx);
    const after = fire(triggers, { on: verb.name, phase: "after" }, glyphCtx, this.#fired);
    const events = [...before.events, ...performed.events, ...after.events];
    if (performed.silent && after.events.length === 0) events.push(say("nothing", performed.silent));
    this.#outcomes.set(actor, "done");
    if (performed.entered) {
      const enter = fire(triggers, { on: "enter", phase: "after" }, { world, actor: intent.actor, target: performed.entered }, this.#fired);
      events.push(...enter.events);
      events.push(...this.#follow(intent.actor, performed.entered));
    }
    return events;
  }

  /**
   * Cut scenes for first sights: the first time a player can see a room or a creature
   * that has art, they get its picture. A room lit later by a torch counts as first seen then.
   */
  #firstSights(): EventDraft[] {
    if (!this.scenario.art) return [];
    const { world } = this;
    const drafts: EventDraft[] = [];
    for (const player of world.things.values()) {
      if (player.traits.actor?.kind !== "player" || !world.isAlive(player.id) || !world.canSee(player.id)) continue;
      const roomId = world.roomOf(player.id);
      if (!roomId) continue;
      const room = world.get(roomId);
      const roomArt = pickArt(room.art, { world, actor: player.id, target: room.id });
      if (roomArt && world.remember(player.id, `sight:${room.id}`)) {
        drafts.push({ name: "beheld", scope: { kind: "actor", actor: player.id }, actor: player.id, target: room.id, text: room.traits.room?.title ?? room.name, art: roomArt });
      }
      for (const t of world.perceivable(player.id)) {
        if (!t.traits.actor || t.traits.actor.kind === "player" || !world.isAlive(t.id)) continue;
        const art = pickArt(t.art, { world, actor: player.id, target: t.id });
        if (art && world.remember(player.id, `sight:${t.id}`)) {
          drafts.push({ name: "beheld", scope: { kind: "actor", actor: player.id }, actor: player.id, target: t.id, text: t.description ?? t.name, art });
        }
      }
    }
    return drafts;
  }

  /** Companions follow their master through exits, like followers in old MUDs. Not a decision. */
  #follow(master: Id, to: Id): EventDraft[] {
    const { world } = this;
    const drafts: EventDraft[] = [];
    for (const t of world.things.values()) {
      const a = t.traits.actor;
      if (!a?.companion || a.serves !== master || t.location === to || t.location === null || !world.isAlive(t.id)) continue;
      const from = world.roomOf(t.id);
      if (!from || from === to) continue;
      drafts.push({ name: "left", scope: { kind: "room", room: from }, actor: t.id, text: `${t.name} follows ${world.get(master).name}.` });
      world.move(t.id, to);
      drafts.push({ name: "entered", scope: { kind: "room", room: to }, actor: t.id, text: `${t.name} follows ${world.get(master).name} in.` });
    }
    return drafts;
  }

  #checkGoals(): EventDraft[] {
    const goal = this.scenario.goal;
    if (!goal) return [];
    const drafts: EventDraft[] = [];
    for (const thing of this.world.things.values()) {
      if (thing.traits.actor?.kind !== "player" || this.#won.has(thing.id)) continue;
      if (check(goal, { world: this.world, actor: thing.id })) {
        this.#won.add(thing.id);
        drafts.push({ name: "won", scope: { kind: "global" }, actor: thing.id, text: `${thing.name} has completed ${this.scenario.title}!`, you: "You have completed the adventure!" });
      }
    }
    return drafts;
  }

  #publish(drafts: EventDraft[]): GameEvent[] {
    return drafts.map((draft) => {
      const event: GameEvent = { tick: this.tick, ...draft };
      this.slip.publish(event);
      return event;
    });
  }
}
