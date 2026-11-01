import type { Id, Scalar, Scenario, Seen, Thing } from "./types.ts";

/**
 * The world state: a tree of things, where each thing's location is its container,
 * plus global flags. This class only stores and queries state; the rules live in
 * the wheel (verbs) and in glyphs (scripts).
 */
export class World {
  readonly things = new Map<Id, Thing>();
  readonly flags = new Map<string, Scalar>();
  /** What each actor has found by searching: perception that light alone doesn't give. */
  readonly #known = new Map<Id, Set<Id>>();
  /** What each actor remembers having experienced: first sights, moments. */
  readonly #memory = new Map<Id, Set<string>>();

  constructor(scenario: Pick<Scenario, "things" | "flags">) {
    for (const thing of structuredClone(scenario.things)) this.things.set(thing.id, thing);
    for (const [k, v] of Object.entries(scenario.flags ?? {})) this.flags.set(k, v);
  }

  // --- senses ------------------------------------------------------------------

  knows(actor: Id, thing: Id): boolean {
    return this.#known.get(actor)?.has(thing) ?? false;
  }

  learn(actor: Id, thing: Id): void {
    const known = this.#known.get(actor) ?? new Set<Id>();
    known.add(thing);
    this.#known.set(actor, known);
  }

  /** Remember something; true if it is new to this actor ("first time I see this room"). */
  remember(actor: Id, key: string): boolean {
    const memory = this.#memory.get(actor) ?? new Set<string>();
    if (memory.has(key)) return false;
    memory.add(key);
    this.#memory.set(actor, memory);
    return true;
  }

  remembers(actor: Id, key: string): boolean {
    return this.#memory.get(actor)?.has(key) ?? false;
  }

  /** A room is lit unless it is dark and no lit light is anywhere in it (carried ones count). */
  isLit(roomId: Id): boolean {
    if (!this.get(roomId).traits.dark) return true;
    const walk = (id: Id): boolean =>
      this.children(id).some((t) => t.traits.light?.lit === true || ((this.isOpen(t.id) || t.traits.actor !== undefined) && walk(t.id)));
    return walk(roomId);
  }

  canSee(actor: Id): boolean {
    const room = this.roomOf(actor);
    return room !== null && !this.get(actor).traits.blind && this.isLit(room);
  }

  /**
   * What an actor actually notices among the things in reach: everything visible
   * if it can see (except concealed things), plus whatever it has found by touch.
   */
  perceivable(actor: Id): Thing[] {
    const sees = this.canSee(actor);
    return this.reachable(actor).filter((t) => this.knows(actor, t.id) || (sees && !t.traits.concealed));
  }

  get(id: Id): Thing {
    const thing = this.things.get(id);
    if (!thing) throw new Error(`No such thing: ${id}`);
    return thing;
  }

  has(id: Id): boolean {
    return this.things.has(id);
  }

  add(thing: Thing): Thing {
    if (this.things.has(thing.id)) throw new Error(`Duplicate thing: ${thing.id}`);
    this.things.set(thing.id, structuredClone(thing));
    return this.get(thing.id);
  }

  /** Direct contents of a container. */
  children(id: Id): Thing[] {
    return [...this.things.values()].filter((t) => t.location === id);
  }

  /** True if thing is somewhere inside holder, at any depth. */
  isInside(thingId: Id, holderId: Id): boolean {
    let at = this.things.get(thingId)?.location ?? null;
    const seen = new Set<Id>();
    while (at !== null && !seen.has(at)) {
      if (at === holderId) return true;
      seen.add(at);
      at = this.things.get(at)?.location ?? null;
    }
    return false;
  }

  /** The room a thing is in, walking up through containers and carriers. */
  roomOf(id: Id): Id | null {
    let current: Thing | undefined = this.things.get(id);
    const seen = new Set<Id>();
    while (current && !seen.has(current.id)) {
      if (current.traits.room) return current.id;
      seen.add(current.id);
      current = current.location === null ? undefined : this.things.get(current.location);
    }
    return null;
  }

  /** The only way anything moves. Refuses to create containment cycles. */
  move(id: Id, destination: Id | null): void {
    const thing = this.get(id);
    if (destination !== null) {
      this.get(destination);
      if (destination === id || this.isInside(destination, id)) {
        throw new Error(`Cannot move ${id} into ${destination}: containment cycle`);
      }
    }
    thing.location = destination;
  }

  /** Read a trait property by path, e.g. "openable.open". Undefined if absent. */
  prop(id: Id, path: string): Scalar | undefined {
    const [trait, key] = splitPath(path);
    return this.get(id).traits[trait]?.[key];
  }

  setProp(id: Id, path: string, value: Scalar): void {
    const [trait, key] = splitPath(path);
    const thing = this.get(id);
    const bag = (thing.traits[trait] ??= {});
    bag[key] = value;
  }

  hasTrait(id: Id, trait: string): boolean {
    return this.get(id).traits[trait] !== undefined;
  }

  grant(id: Id, trait: string, props: Record<string, Scalar> = {}): void {
    const thing = this.get(id);
    thing.traits[trait] = { ...(thing.traits[trait] ?? {}), ...props };
  }

  revoke(id: Id, trait: string): void {
    delete this.get(id).traits[trait];
  }

  isAlive(id: Id): boolean {
    const vitals = this.get(id).traits.vitals;
    return !vitals || vitals.hp > 0;
  }

  /** Whether the contents of a container can be seen and reached. */
  isOpen(id: Id): boolean {
    const t = this.get(id);
    if (t.traits.room || t.traits.actor) return true;
    if (!t.traits.container) return false;
    return t.traits.container.transparent === true || !t.traits.openable || t.traits.openable.open;
  }

  /**
   * Things an actor can perceive and reach in its room: everything in the room,
   * plus contents of open containers (recursively). Excludes the actor itself,
   * its inventory, exits (see exitsFrom) and other actors' inventories.
   */
  reachable(actorId: Id): Thing[] {
    const room = this.roomOf(actorId);
    if (!room) return [];
    const out: Thing[] = [];
    const walk = (containerId: Id) => {
      for (const t of this.children(containerId)) {
        if (t.id === actorId || t.traits.exit) continue;
        out.push(t);
        if (!t.traits.actor && this.isOpen(t.id)) walk(t.id);
      }
    };
    walk(room);
    return out;
  }

  /** Visible exits of a room. */
  exitsFrom(roomId: Id): Thing[] {
    return this.children(roomId).filter((t) => t.traits.exit && !t.traits.exit.hidden);
  }

  /** Inventory, including contents of open carried containers. */
  carried(actorId: Id): Thing[] {
    const out: Thing[] = [];
    const walk = (containerId: Id) => {
      for (const t of this.children(containerId)) {
        out.push(t);
        if (this.isOpen(t.id)) walk(t.id);
      }
    };
    walk(actorId);
    return out;
  }

  /** A short description of a thing as perceived. */
  seen(id: Id): Seen {
    const t = this.get(id);
    const state: string[] = [];
    if (t.traits.openable) state.push(t.traits.openable.open ? "open" : "closed");
    if (t.traits.lockable?.locked) state.push("locked");
    if (t.traits.light) state.push(t.traits.light.lit ? "lit" : "unlit");
    if (t.traits.vitals) {
      const { hp, maxHp } = t.traits.vitals;
      state.push(hp > 0 ? `hp ${hp}/${maxHp}` : "dead");
    }
    if (t.traits.linkdead) state.push("motionless");
    const seen: Seen = { id: t.id, name: t.name, state };
    if (t.description) seen.description = t.description;
    if (t.location && !this.get(t.location).traits.room) seen.inside = t.location;
    return seen;
  }

  /** A sherd: a serializable snapshot of the whole state. */
  snapshot(): { things: Thing[]; flags: Record<string, Scalar>; known: Record<Id, Id[]>; memory: Record<Id, string[]> } {
    return {
      things: structuredClone([...this.things.values()]),
      flags: Object.fromEntries(this.flags),
      known: Object.fromEntries([...this.#known].map(([actor, ids]) => [actor, [...ids]])),
      memory: Object.fromEntries([...this.#memory].map(([actor, keys]) => [actor, [...keys]])),
    };
  }
}

function splitPath(path: string): [string, string] {
  const dot = path.indexOf(".");
  if (dot <= 0 || dot === path.length - 1) throw new Error(`Bad trait path "${path}", expected "trait.key"`);
  return [path.slice(0, dot), path.slice(dot + 1)];
}
