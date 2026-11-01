import type { Id } from "@claywork/clay";
import { Wheel } from "@claywork/wheel";
import { awaken, type Animated } from "@claywork/golems";
import type { InstanceInfo } from "./protocol.ts";
import type { Session } from "./session.ts";
import type { ShelvedWorld } from "./worlds.ts";
import { silent, type Debug } from "./debug.ts";

export interface InstanceOptions {
  /** Milliseconds per tick. 0 = never start the timer (tests turn the wheel by hand). */
  tickMs: number;
  debug?: Debug;
}

/**
 * One running copy of a world: a wheel, its awakened inhabitants, and the party of
 * players in it. Bodies of disconnected players stay (link-dead) until they leave.
 */
export class Instance {
  readonly id: string;
  readonly world: ShelvedWorld;
  readonly wheel: Wheel;
  /** actor id -> session, for everyone whose body is in this world. */
  readonly members = new Map<Id, Session>();
  readonly #handles: Animated[];
  readonly #unturn: () => void;
  #next = 1;

  constructor(id: string, world: ShelvedWorld, options: InstanceOptions) {
    this.id = id;
    this.world = world;
    this.wheel = new Wheel(world.scenario);
    const debug = options.debug ?? silent;
    const at = () => `[${id} t${this.wheel.tick}]`;
    this.#handles = awaken(this.wheel, world.minds?.() ?? {}, {
      ...(debug.on("golems")
        ? {
            onDecision: (d) => {
              const signals = Object.entries(d.signals ?? {}).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ");
              debug.log("golems", `${at()} ${d.actor} chose ${d.option} via ${d.source} in ${d.ms}ms${d.why ? `: ${d.why}` : ""}${signals ? ` (${signals})` : ""}`);
            },
          }
        : {}),
    });
    const unwatch: (() => void)[] = [];
    if (debug.on("events")) {
      unwatch.push(this.wheel.slip.subscribe((e) => {
        const scope = e.scope.kind === "global" ? "everyone" : e.scope.kind === "room" ? `room ${e.scope.room}` : `only ${e.scope.actor}`;
        const who = [e.actor, e.target].filter(Boolean).join(" → ");
        debug.log("events", `${at()} ${e.name}${who ? ` ${who}` : ""} [${scope}] ${e.text}`);
      }));
    }
    if (debug.on("intents")) {
      unwatch.push(this.wheel.onSubmit((i) => {
        const rest = [i.target, i.with ? `with ${i.with}` : "", i.text ? JSON.stringify(i.text) : ""].filter(Boolean).join(" ");
        debug.log("intents", `${at()} ${i.actor} wants to ${i.verb}${rest ? ` ${rest}` : ""}`);
      }));
    }
    const unturn = this.wheel.onTurn(() => {
      for (const session of this.members.values()) session.refresh();
    });
    this.#unturn = () => {
      unturn();
      for (const u of unwatch) u();
    };
    if (options.tickMs > 0) this.wheel.start(options.tickMs);
  }

  join(session: Session, name: string): Id {
    const actor = `${this.id}-p${this.#next++}`;
    this.wheel.join({ id: actor, name });
    this.members.set(actor, session);
    return actor;
  }

  leave(actor: Id): void {
    this.wheel.leave(actor);
    this.members.delete(actor);
  }

  get empty(): boolean {
    return this.members.size === 0;
  }

  stop(): void {
    this.wheel.stop();
    this.#unturn();
    for (const h of this.#handles) h.stop();
  }

  info(): InstanceInfo {
    return {
      id: this.id,
      world: this.world.id,
      title: this.world.scenario.title,
      members: [...this.members].map(([actor, s]) => ({ name: this.wheel.world.get(actor).name, present: s.connected })),
    };
  }
}
