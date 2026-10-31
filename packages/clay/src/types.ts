// Clay: the material everything is made of.
// Everything in the world is a Thing. A Thing is defined by where it is
// (its location, another Thing) and by which traits it has.

export type Id = string;
export type Scalar = string | number | boolean | null;

/**
 * Traits are the "-ables": small bundles of state that give a Thing abilities.
 * Known traits are typed; unknown ones are allowed so worlds can invent their own
 * and script them with glyphs.
 */
export interface Traits {
  /** A place an actor can stand in. Its location is usually null (or a zone). */
  room?: { title?: string };
  /** A passage, located in a room, leading to another room. */
  exit?: { to: Id; direction?: string; hidden?: boolean };
  /** Can be picked up. */
  takeable?: { weight?: number };
  /** Can hold other things. Closed opaque containers hide their contents. */
  container?: { transparent?: boolean };
  openable?: { open: boolean };
  lockable?: { locked: boolean; key?: Id };
  /** Can act: players, NPCs, mobs. */
  actor?: { kind?: "player" | "npc" | "mob"; persona?: string; goal?: string };
  vitals?: { hp: number; maxHp: number };
  weapon?: { damage: number };
  /** Anything else a world invents, e.g. lightable: { lit: false }. */
  [trait: string]: Record<string, Scalar | undefined> | undefined;
}

export interface Thing {
  id: Id;
  name: string;
  description?: string;
  /** The container: a room, a chest, an actor's inventory. null = nowhere / top level. */
  location: Id | null;
  aliases?: string[];
  traits: Traits;
}

// ---------------------------------------------------------------------------
// Glyphs: the scripting DSL, pure data so it can be validated and generated.
// References may be literal ids or placeholders resolved from the event:
// "$actor" (who acts), "$target" (what is acted on).
// ---------------------------------------------------------------------------

export type Ref = Id | "$actor" | "$target";

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  /** Truthy flag, or flag equal to a value. */
  | { flag: string; equals?: Scalar }
  /** Thing is somewhere inside holder (directly or nested). */
  | { has: [holder: Ref, thing: Ref] }
  /** Thing is directly located in place. */
  | { at: [thing: Ref, place: Ref] }
  /** Trait property comparison, path like "openable.open" or "vitals.hp". */
  | { prop: [thing: Ref, path: string]; equals?: Scalar; gt?: number; lt?: number }
  /** Who triggered the event. */
  | { actorIs: Ref };

export type Effect =
  /** Narration. Heard by the room of the actor, or only by the actor. */
  | { say: string; to?: "room" | "actor" }
  | { set: [thing: Ref, path: string, value: Scalar] }
  | { move: [thing: Ref, destination: Ref | null] }
  | { setFlag: string; value?: Scalar }
  /** Make a hidden exit visible. */
  | { reveal: Ref }
  /** Remove a thing from the world (moves it to nowhere). */
  | { destroy: Ref }
  /** Only meaningful in "before" triggers: the verb does not happen. */
  | { block: true };

export interface Trigger {
  id: string;
  /** Verb name ("open", "take", "attack"), or "enter" for arriving in a room. */
  on: string;
  /** "before" can block the verb; "after" runs only if it succeeded. Default "after". */
  phase?: "before" | "after";
  /** Only for this target (the thing acted on, or the room for "enter"). */
  target?: Id;
  if?: Condition[];
  then: Effect[];
  else?: Effect[];
  /** Fire at most once per world. */
  once?: boolean;
}

// ---------------------------------------------------------------------------
// Intents and events. Actors never change the world directly: they submit
// intents, the wheel resolves them, and publishes events describing what happened.
// ---------------------------------------------------------------------------

export interface Intent {
  actor: Id;
  verb: string;
  target?: Id;
  /** Instrument: "unlock door with key", "attack goblin with shovel". */
  with?: Id;
  /** Free text, for "say". */
  text?: string;
}

export type Scope =
  | { kind: "room"; room: Id }
  | { kind: "actor"; actor: Id }
  | { kind: "global" };

export interface GameEvent {
  tick: number;
  /** Past tense facts: "taken", "opened", "entered", "attacked", "died", "narration", "failed"... */
  name: string;
  scope: Scope;
  actor?: Id;
  target?: Id;
  /** Third person text, for everyone else. */
  text: string;
  /** Second person text, for the actor ("You take the key."). */
  you?: string;
  data?: Record<string, Scalar>;
}

export type EventDraft = Omit<GameEvent, "tick">;

// ---------------------------------------------------------------------------
// Scenario: a whole world as data. This is what the Potter (an LLM) generates
// and what the Kiln fires before it goes live.
// ---------------------------------------------------------------------------

export interface Scenario {
  id: string;
  title: string;
  intro?: string;
  /** Room a newly joining player spawns in. */
  spawn: Id;
  things: Thing[];
  flags?: Record<string, Scalar>;
  triggers?: Trigger[];
  /** When this holds, the scenario is complete. "$actor" is the player. */
  goal?: Condition;
  /** A known solution, used by the Kiln to prove the scenario is winnable. */
  walkthrough?: Omit<Intent, "actor">[];
}

// ---------------------------------------------------------------------------
// Perception and decisions: the same shape for humans, rules and models.
// ---------------------------------------------------------------------------

export interface Seen {
  id: Id;
  name: string;
  description?: string;
  /** Short state tags: "closed", "locked", "hp 4/8", "dead". */
  state: string[];
  /** For things inside open containers: where they are. */
  inside?: Id;
}

export interface Observation {
  tick: number;
  self: Seen & { carrying: Seen[] };
  room: { id: Id; title: string; description?: string };
  visible: Seen[];
  exits: (Seen & { direction?: string })[];
  /** Recent events this actor perceived, rendered from its perspective. */
  recent: string[];
}

export interface Option {
  /** Stable id, e.g. "take:rusty_key", "go:crypt_door". */
  id: string;
  intent: Intent;
  /** Short label for links and buttons. */
  label: string;
  /** One line rule description, the way a decision model learns the rules at request time. */
  hint: string;
}

export interface DecisionPoint {
  actor: Id;
  observation: Observation;
  persona?: string;
  goal?: string;
  options: Option[];
}
