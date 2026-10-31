import type { GameEvent, Id } from "@claywork/clay";

export type Listener = (event: GameEvent) => void;

/** Where an actor is right now; injected so the bus stays independent of the world. */
export type Locate = (actor: Id) => Id | null;

/**
 * Slip: liquid clay that joins pieces together. The event bus.
 *
 * Every published event has a scope (room / actor / global). Perception is decided
 * at publish time: an actor perceives a room event if it is in that room *now*,
 * so "left" must be published before a move and "entered" after it.
 */
export class Slip {
  readonly log: GameEvent[] = [];
  readonly #listeners = new Set<{ fn: Listener; actor?: Id }>();
  readonly #perceived = new Map<Id, GameEvent[]>();
  readonly #memory: number;
  readonly #locate: Locate;

  constructor(locate: Locate, options: { memory?: number } = {}) {
    this.#locate = locate;
    this.#memory = options.memory ?? 20;
  }

  /** Whether an actor, where it is now, perceives this event. */
  reaches(event: GameEvent, actor: Id): boolean {
    switch (event.scope.kind) {
      case "global":
        return true;
      case "actor":
        return event.scope.actor === actor;
      case "room":
        return this.#locate(actor) === event.scope.room;
    }
  }

  /**
   * Subscribe to everything (world observers, logs, sockets) or, with an actor,
   * only to what that actor perceives (players, golems).
   */
  subscribe(fn: Listener, filter: { actor?: Id } = {}): () => void {
    const entry = filter.actor === undefined ? { fn } : { fn, actor: filter.actor };
    this.#listeners.add(entry);
    return () => this.#listeners.delete(entry);
  }

  /** Remember what an actor perceives, so observations can include recent events. */
  track(actor: Id): void {
    if (!this.#perceived.has(actor)) this.#perceived.set(actor, []);
  }

  publish(event: GameEvent): void {
    this.log.push(event);
    for (const [actor, memory] of this.#perceived) {
      if (!this.reaches(event, actor)) continue;
      memory.push(event);
      if (memory.length > this.#memory) memory.shift();
    }
    for (const { fn, actor } of [...this.#listeners]) {
      if (actor === undefined || this.reaches(event, actor)) fn(event);
    }
  }

  /** The last n events an actor perceived (it must be tracked). */
  recent(actor: Id, n = 5): GameEvent[] {
    return (this.#perceived.get(actor) ?? []).slice(-n);
  }
}

/** Render an event from a viewer's perspective. */
export function perspective(event: GameEvent, viewer: Id): string {
  return event.actor === viewer && event.you ? event.you : event.text;
}
