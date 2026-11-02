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
  room?: { title?: string; /** What you hear when you listen here. */ sounds?: string };
  /** The room is dark: without light, things must be found by touch (search). */
  dark?: { /** Replaces the room description when you can't see. */ text?: string };
  /** A light source. Lit lights anywhere in a room (even carried) make it visible. */
  light?: { lit: boolean };
  /** Not noticed even in light until someone searches. */
  concealed?: {};
  /** Sounds from another room reach this one, muffled unless you listen. */
  echo?: { from: Id; /** What unclear speech sounds like here. */ muffled?: string };
  /** This actor cannot see. */
  blind?: {};
  /** The player behind this actor has lost their connection; the body stays in the world. */
  linkdead?: {};
  /** A passage, located in a room, leading to another room. */
  exit?: { to: Id; direction?: string; hidden?: boolean };
  /** Can be picked up. */
  takeable?: { weight?: number };
  /** Can hold other things. Closed opaque containers hide their contents. */
  container?: { transparent?: boolean };
  openable?: { open: boolean };
  lockable?: { locked: boolean; key?: Id };
  /** Can act: players, NPCs, mobs. */
  actor?: {
    kind?: "player" | "npc" | "mob";
    persona?: string;
    goal?: string;
    /** Consecutive ticks spent in chosen stillness (wait, listen). Maintained by the wheel. */
    still?: number;
    /** Paying attention to sounds. Lasts while the actor stays still. */
    listening?: boolean;
    /** Whom this actor serves: its master. Shapes roles (master, servant, ally, foe). */
    serves?: Id;
    /** Side in a fight. Default: the master's faction, "players" for players, else "wild". */
    faction?: string;
    /** The archetype (Scenario.archetypes) whose mind this actor thinks with. */
    archetype?: string;
    /** Joined with a player (Scenario.player.companions) and leaves with them. */
    companion?: boolean;
    /** How minds refer to it, when "the" + name won't do: "the Clay Warden". */
    called?: string;
  };
  vitals?: { hp: number; maxHp: number };
  weapon?: { damage: number };
  /** Anything else a world invents, e.g. lightable: { lit: false }. */
  [trait: string]: Record<string, Scalar | undefined> | undefined;
}

// ---------------------------------------------------------------------------
// Art: pixel sprites written as text. Each row is one line of pixels, one character
// per pixel; "." is transparent and every other character is a palette color.
// ---------------------------------------------------------------------------

export interface Sprite {
  /** Single character -> CSS hex color, e.g. { "O": "#2a2a2a" }. */
  palette: Record<string, string>;
  rows: string[];
}

/**
 * Which sprite a thing shows: one id, or a default plus variants chosen by glyph
 * conditions ("$target" is the thing itself), first match wins.
 */
export type ArtRef = string | { default: string; when?: { if: Condition; use: string }[] };

export interface Thing {
  id: Id;
  name: string;
  description?: string;
  /** Shown as a cut scene when the thing is first seen, or looked at. Rooms show it on first sight. */
  art?: ArtRef;
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

export type Ref = Id | "$actor" | "$target" | "$self" | "$master";

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
  | { actorIs: Ref }
  /** Thing has a trait: { "trait": ["$actor", "mute"] }. */
  | { trait: [thing: Ref, trait: string] }
  /** Actor has stayed still (waited) for at least this many consecutive ticks. */
  | { still: [actor: Ref, ticks: number] }
  /** The thing exists in the world and, if it has vitals, is alive. */
  | { alive: Ref };

export type Effect =
  /** Narration, optionally with a cut scene. Heard by the room of the actor, or only by the actor. */
  | { say: string; to?: "room" | "actor"; art?: string }
  | { set: [thing: Ref, path: string, value: Scalar] }
  | { move: [thing: Ref, destination: Ref | null] }
  | { setFlag: string; value?: Scalar }
  /** Make a hidden exit visible. */
  | { reveal: Ref }
  /** Remove a thing from the world (moves it to nowhere). */
  | { destroy: Ref }
  /** Give a thing a trait (a curse, a blessing, a new ability). */
  | { grant: [thing: Ref, trait: string, props?: Record<string, Scalar>] }
  /** Take a trait away. */
  | { revoke: [thing: Ref, trait: string] }
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
// Verbs as world configuration. Standard verbs are a library every world inherits;
// a world can switch them off, restrict them, re-describe them, or add its own.
// ---------------------------------------------------------------------------

/**
 * A condition the acting actor must meet. When it doesn't, the verb fails with
 * flavor: the option is still offered, the world just says no.
 */
export interface Requirement {
  if?: Condition;
  unless?: Condition;
  /** What the actor is told. Default: "You can't do that right now." */
  fail?: string;
}

export interface VerbConfig {
  summary?: string;
  /** How to type it. Default: "<phrase> <thing>" or the name. */
  usage?: string;
  aliases?: string[];
  requires?: Requirement[];
  // --- world verbs only (ignored for standard verbs) ---
  /** Which things the verb applies to. Omit for an untargeted verb ("pray", "sing"). */
  appliesTo?: { trait?: string; ids?: Id[] };
  /** Words before the target in labels: "pray at" -> "pray at stone altar". Default: the name. */
  phrase?: string;
  /** What everyone sees and what the actor is told. Templates: {actor} {Actor} {target} {Target}. */
  text?: string;
  you?: string;
  /** Told to the actor when no trigger answered. Default: "Nothing happens." */
  nothing?: string;
}

// ---------------------------------------------------------------------------
// Minds: how a golem perceives and decides, as world data. Everything a decision
// model reads is rendered from the golem's own point of view, in roles.
// ---------------------------------------------------------------------------

/** How another actor relates to an observer. */
export type Role = "self" | "master" | "servant" | "ally" | "foe" | "other";

/** A companion template: a thing that joins with each player, with what it carries. */
export type Companion = Omit<Thing, "location"> & { carrying?: Omit<Thing, "location">[] };

export interface Archetype {
  /** Who the creature is, in prose. Character words act as strong priors: keep them consistent with the goals. */
  persona: string;
  /**
   * Goals by phase: the first phase whose `when` holds is current; a phase without `when`
   * is the default. Phases change the creature's situation (its master died), never its choice.
   * Write goals as single triggers in the options' own words: "Attack whoever attacks your master."
   */
  phases: { id: string; when?: Condition; goal: string }[];
  /** Verbs it considers at all, e.g. ["attack", "go", "wait"]. */
  repertoire: string[];
  /** Moves never offered, as verb:role, e.g. "attack:master". Constraints belong in structure, not prose. */
  forbid?: string[];
  /** Whose words it hears verbatim. Others' speech arrives as "shouts something". Default: everyone. */
  hears?: Role[];
  /** How many noticed events it keeps in mind. Default 4. */
  memory?: number;
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
  /** Second person text, for the target when it perceives ("The goblin hits you."). */
  them?: string;
  /** A sprite id from the world's art library: this moment comes with a picture. */
  art?: string;
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
  /**
   * Verb configuration: false switches a standard verb off (except "wait", the floor),
   * an object restricts or re-describes a standard verb, or defines a new world verb.
   */
  verbs?: Record<string, VerbConfig | false>;
  /** The world's sprites, by id. */
  art?: Record<string, Sprite>;
  /** Archetypes by id: the minds world actors think with. */
  archetypes?: Record<string, Archetype>;
  /**
   * Template for joining players: extra traits (merged over the defaults), starting hp, and
   * companions that join with each player and serve them (ids are prefixed with the player's).
   */
  player?: { traits?: Traits; hp?: number; companions?: Companion[] };
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
  /** The actor cannot see: only things it has found are listed. */
  dark: boolean;
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
