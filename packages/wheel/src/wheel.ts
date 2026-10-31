import { World } from "@claywork/clay";
import type { DecisionPoint, EventDraft, GameEvent, Id, Intent, Observation, Option, Scenario, Thing } from "@claywork/clay";
import { fire, check } from "@claywork/glyphs";
import { Slip, perspective } from "@claywork/slip";
import { standardVerbs, type Verb } from "./verbs.ts";

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
  readonly #queue = new Map<Id, Intent>();
  readonly #fired = new Set<string>();
  readonly #turnListeners = new Set<(events: GameEvent[]) => void>();
  readonly #won = new Set<Id>();
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(scenario: Scenario, options: WheelOptions = {}) {
    this.scenario = scenario;
    this.world = new World(scenario);
    this.slip = new Slip((id) => (this.world.has(id) ? this.world.roomOf(id) : null), { memory: options.memory ?? 20 });
    for (const verb of options.verbs ?? standardVerbs) this.#verbs.set(verb.name, verb);
    for (const thing of this.world.things.values()) if (thing.traits.actor) this.slip.track(thing.id);
  }

  /** A player joins the running world at the spawn room. */
  join(player: Player): Thing {
    const hp = player.hp ?? 20;
    const thing = this.world.add({
      id: player.id,
      name: player.name,
      ...(player.description ? { description: player.description } : {}),
      location: this.scenario.spawn,
      traits: { actor: { kind: "player" }, vitals: { hp, maxHp: hp } },
    });
    this.slip.track(thing.id);
    this.#publish([
      { name: "entered", scope: { kind: "room", room: this.scenario.spawn }, actor: thing.id, text: `${thing.name} appears.`, you: this.scenario.intro ?? "You arrive." },
    ]);
    return thing;
  }

  /** Queue an intent for the next turn. A newer intent from the same actor replaces the old one. */
  submit(intent: Intent): void {
    this.#queue.delete(intent.actor);
    this.#queue.set(intent.actor, intent);
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
    const produced: GameEvent[] = [];
    for (const intent of intents) produced.push(...this.#publish(this.#resolve(intent)));
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

  /** What an actor perceives, ready to render (glaze) or to send to a model (golems). */
  observe(actor: Id): Observation {
    const { world } = this;
    const roomId = world.roomOf(actor);
    if (!roomId) throw new Error(`${actor} is nowhere`);
    const room = world.get(roomId);
    const self = world.seen(actor);
    return {
      tick: this.tick,
      self: { ...self, carrying: world.carried(actor).map((t) => world.seen(t.id)) },
      room: { id: room.id, title: room.traits.room?.title ?? room.name, ...(room.description ? { description: room.description } : {}) },
      visible: world.reachable(actor).map((t) => world.seen(t.id)),
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
    const fail = (text: string): EventDraft[] => [{ name: "failed", scope: { kind: "actor", actor: intent.actor }, actor: intent.actor, text, you: text }];

    if (!world.has(intent.actor) || !world.isAlive(intent.actor)) return [];
    const verb = this.#verbs.get(intent.verb);
    if (!verb) return fail(`You don't know how to ${intent.verb}.`);
    const ctx = { world, actor: intent.actor, intent };
    const problem = verb.check(ctx);
    if (problem) return fail(problem);

    const triggers = this.scenario.triggers ?? [];
    const glyphCtx = { world, actor: intent.actor, ...(intent.target ? { target: intent.target } : {}) };
    const before = fire(triggers, { on: verb.name, phase: "before" }, glyphCtx, this.#fired);
    if (before.blocked) return before.events;

    const performed = verb.perform(ctx);
    const after = fire(triggers, { on: verb.name, phase: "after" }, glyphCtx, this.#fired);
    const events = [...before.events, ...performed.events, ...after.events];
    if (performed.entered) {
      const enter = fire(triggers, { on: "enter", phase: "after" }, { world, actor: intent.actor, target: performed.entered }, this.#fired);
      events.push(...enter.events);
    }
    return events;
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
