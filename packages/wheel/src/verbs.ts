import type { EventDraft, Id, Intent, Option, Thing, World } from "@claywork/clay";

export interface VerbContext {
  world: World;
  intent: Intent;
  actor: Id;
}

export interface Performed {
  events: EventDraft[];
  /** Room the actor arrived in, so "enter" triggers can fire. */
  entered?: Id;
}

/**
 * A verb is the only way state changes. It knows which options are legal for an actor
 * (so humans and models choose from the same closed set), how to check an intent
 * without side effects, and how to perform it.
 */
export interface Verb {
  name: string;
  /** One line for /help, world independent. */
  summary: string;
  /** How to type it, e.g. "take <thing>". */
  usage: string;
  /** Other words players may type: "get" for take, "l" for look. */
  aliases?: string[];
  /** Takes free text instead of a target (say). Such verbs have no options. */
  freeText?: boolean;
  options(world: World, actor: Id): Option[];
  /** Why the intent cannot happen, or null if it can. Must not mutate. */
  check(ctx: VerbContext): string | null;
  perform(ctx: VerbContext): Performed;
}

// --- helpers ---------------------------------------------------------------

/** "the iron chest", but "Anna" for capitalized proper names. */
export function the(thing: Thing): string {
  return /^[A-Z]/.test(thing.name) ? thing.name : `the ${thing.name}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Everything an actor can touch: reachable things, inventory and visible exits. */
export function touchable(world: World, actor: Id): Thing[] {
  const room = world.roomOf(actor);
  return [...world.reachable(actor), ...world.carried(actor), ...(room ? world.exitsFrom(room) : [])];
}

function canTouch(world: World, actor: Id, target: Id): boolean {
  return touchable(world, actor).some((t) => t.id === target);
}

function roomScope(world: World, actor: Id) {
  const room = world.roomOf(actor);
  return room ? ({ kind: "room", room } as const) : ({ kind: "actor", actor } as const);
}

function option(actor: Id, verb: string, target: Thing | undefined, label: string, hint: string, extra: Partial<Intent> = {}): Option {
  const intent: Intent = { actor, verb, ...extra };
  if (target) intent.target = target.id;
  const id = [verb, target?.id, extra.with].filter(Boolean).join(":");
  return { id, intent, label, hint };
}

function targetOf(ctx: VerbContext): Thing | null {
  const id = ctx.intent.target;
  return id && ctx.world.has(id) ? ctx.world.get(id) : null;
}

/** The best weapon an actor carries, or bare hands. */
export function weaponOf(world: World, actor: Id): { thing?: Thing; damage: number } {
  let best: { thing?: Thing; damage: number } = { damage: 1 };
  for (const t of world.carried(actor)) {
    const damage = t.traits.weapon?.damage ?? 0;
    if (damage > best.damage) best = { thing: t, damage };
  }
  return best;
}

// --- verbs -----------------------------------------------------------------

const look: Verb = {
  name: "look",
  summary: "Look around, or examine something closely. Details sometimes reveal secrets.",
  usage: "look [thing]",
  aliases: ["l", "examine", "x"],
  options(world, actor) {
    const around = option(actor, "look", undefined, "look around", "Look around the room. Safe, but the moment passes.");
    return [
      around,
      ...touchable(world, actor).map((t) =>
        option(actor, "look", t, `look at ${t.name}`, `Examine ${the(t)} closely. Details sometimes reveal secrets.`),
      ),
    ];
  },
  check(ctx) {
    const t = ctx.intent.target;
    if (t && !canTouch(ctx.world, ctx.actor, t)) return "You don't see that here.";
    return null;
  },
  perform({ world, actor, intent }) {
    const target = intent.target ? world.get(intent.target) : world.get(world.roomOf(actor)!);
    const text = target.description ?? `You see nothing special about ${the(target)}.`;
    return {
      events: [{ name: "looked", scope: { kind: "actor", actor }, actor, target: target.id, text, you: text }],
    };
  },
};

const go: Verb = {
  name: "go",
  summary: "Leave through an exit.",
  usage: "go <direction>",
  aliases: ["walk", "move"],
  options(world, actor) {
    const room = world.roomOf(actor);
    if (!room) return [];
    return world.exitsFrom(room).map((exit) => {
      const dir = exit.traits.exit!.direction;
      const label = dir ? `go ${dir}` : `go through ${exit.name}`;
      const dest = world.get(exit.traits.exit!.to);
      return option(actor, "go", exit, label, `Leave through ${the(exit)} towards ${the(dest)}.`);
    });
  },
  check({ world, actor, intent }) {
    const exit = intent.target && world.has(intent.target) ? world.get(intent.target) : null;
    if (!exit?.traits.exit || exit.traits.exit.hidden || exit.location !== world.roomOf(actor)) {
      return "You can't go that way.";
    }
    if (exit.traits.openable && !exit.traits.openable.open) return `${cap(the(exit))} is closed.`;
    return null;
  },
  perform({ world, actor, intent }) {
    const exit = world.get(intent.target!);
    const from = world.roomOf(actor)!;
    const to = exit.traits.exit!.to;
    const who = world.get(actor);
    const dir = exit.traits.exit!.direction;
    world.move(actor, to);
    return {
      entered: to,
      events: [
        { name: "left", scope: { kind: "room", room: from }, actor, target: exit.id, text: `${cap(the(who))} leaves${dir ? ` ${dir}` : ""}.` },
        {
          name: "entered",
          scope: { kind: "room", room: to },
          actor,
          target: to,
          text: `${cap(the(who))} arrives.`,
          you: `You go ${dir ?? `through ${the(exit)}`}.`,
        },
      ],
    };
  },
};

const take: Verb = {
  name: "take",
  summary: "Pick something up and carry it.",
  usage: "take <thing>",
  aliases: ["get", "grab"],
  options(world, actor) {
    return world
      .reachable(actor)
      .filter((t) => t.traits.takeable)
      .map((t) => option(actor, "take", t, `take ${t.name}`, `Pick up ${the(t)} and carry it.`));
  },
  check({ world, actor, intent }) {
    const t = intent.target;
    if (!t || !world.reachable(actor).some((x) => x.id === t)) return "You don't see that here.";
    if (!world.get(t).traits.takeable) return "You can't take that.";
    return null;
  },
  perform({ world, actor, intent }) {
    const t = world.get(intent.target!);
    world.move(t.id, actor);
    const who = world.get(actor);
    return {
      events: [{ name: "taken", scope: roomScope(world, actor), actor, target: t.id, text: `${cap(the(who))} takes ${the(t)}.`, you: `You take ${the(t)}.` }],
    };
  },
};

const drop: Verb = {
  name: "drop",
  summary: "Put something you carry down.",
  usage: "drop <thing>",
  options(world, actor) {
    return world.children(actor).map((t) => option(actor, "drop", t, `drop ${t.name}`, `Put ${the(t)} down here.`));
  },
  check({ world, actor, intent }) {
    if (!intent.target || !world.has(intent.target) || world.get(intent.target).location !== actor) {
      return "You aren't carrying that.";
    }
    return null;
  },
  perform({ world, actor, intent }) {
    const t = world.get(intent.target!);
    world.move(t.id, world.roomOf(actor));
    const who = world.get(actor);
    return {
      events: [{ name: "dropped", scope: roomScope(world, actor), actor, target: t.id, text: `${cap(the(who))} drops ${the(t)}.`, you: `You drop ${the(t)}.` }],
    };
  },
};

function toggle(name: "open" | "close", open: boolean): Verb {
  const past = open ? "opens" : "closes";
  return {
    name,
    summary: open ? "Open a door, a chest or anything else that opens." : "Close something that is open.",
    usage: `${name} <thing>`,
    options(world, actor) {
      return touchable(world, actor)
        .filter((t) => t.traits.openable && t.traits.openable.open !== open)
        .map((t) => option(actor, name, t, `${name} ${t.name}`, `${cap(name)} ${the(t)}.${open && t.traits.lockable?.locked ? " It looks locked." : ""}`));
    },
    check(ctx) {
      const t = targetOf(ctx);
      if (!t || !canTouch(ctx.world, ctx.actor, t.id)) return "You don't see that here.";
      if (!t.traits.openable) return `You can't ${name} that.`;
      if (t.traits.openable.open === open) return `${cap(the(t))} is already ${open ? "open" : "closed"}.`;
      if (open && t.traits.lockable?.locked) return `${cap(the(t))} is locked.`;
      return null;
    },
    perform({ world, actor, intent }) {
      const t = world.get(intent.target!);
      world.setProp(t.id, "openable.open", open);
      const who = world.get(actor);
      const event: EventDraft = {
        name: open ? "opened" : "closed",
        scope: roomScope(world, actor),
        actor,
        target: t.id,
        text: `${cap(the(who))} ${past} ${the(t)}.`,
        you: `You ${name} ${the(t)}.`,
      };
      if (open && t.traits.container) {
        const inside = world.children(t.id);
        if (inside.length) event.you += ` Inside: ${inside.map((x) => x.name).join(", ")}.`;
      }
      return { events: [event] };
    },
  };
}

const unlock: Verb = {
  name: "unlock",
  summary: "Unlock something, if you carry the right key.",
  usage: "unlock <thing>",
  options(world, actor) {
    const keys = new Set(world.carried(actor).map((t) => t.id));
    return touchable(world, actor)
      .filter((t) => t.traits.lockable?.locked && t.traits.lockable.key && keys.has(t.traits.lockable.key))
      .map((t) => {
        const key = world.get(t.traits.lockable!.key!);
        return option(actor, "unlock", t, `unlock ${t.name} with ${key.name}`, `Unlock ${the(t)} using ${the(key)}.`, { with: key.id });
      });
  },
  check(ctx) {
    const { world, actor, intent } = ctx;
    const t = targetOf(ctx);
    if (!t || !canTouch(world, actor, t.id)) return "You don't see that here.";
    if (!t.traits.lockable?.locked) return `${cap(the(t))} isn't locked.`;
    if (!intent.with || !world.isInside(intent.with, actor)) return "You need a key.";
    if (t.traits.lockable.key !== intent.with) return "That doesn't fit.";
    return null;
  },
  perform({ world, actor, intent }) {
    const t = world.get(intent.target!);
    const key = world.get(intent.with!);
    world.setProp(t.id, "lockable.locked", false);
    const who = world.get(actor);
    return {
      events: [
        { name: "unlocked", scope: roomScope(world, actor), actor, target: t.id, text: `${cap(the(who))} unlocks ${the(t)}.`, you: `You unlock ${the(t)} with ${the(key)}.` },
      ],
    };
  },
};

const attack: Verb = {
  name: "attack",
  summary: "Strike someone with the best weapon you carry. They may strike back.",
  usage: "attack <someone>",
  aliases: ["hit", "kill", "fight"],
  options(world, actor) {
    const weapon = weaponOf(world, actor);
    const using = weapon.thing ? ` with ${the(weapon.thing)}` : " with bare hands";
    return world
      .reachable(actor)
      .filter((t) => t.traits.actor && t.traits.vitals && world.isAlive(t.id))
      .map((t) =>
        option(actor, "attack", t, `attack ${t.name}`, `Strike ${the(t)}${using} for ${weapon.damage} damage. They may strike back.`),
      );
  },
  check(ctx) {
    const t = targetOf(ctx);
    if (!t || !ctx.world.reachable(ctx.actor).some((x) => x.id === t.id)) return "There's no one like that here.";
    if (!t.traits.vitals || !t.traits.actor) return "Attacking that would achieve nothing.";
    if (!ctx.world.isAlive(t.id)) return `${cap(the(t))} is already dead.`;
    return null;
  },
  perform({ world, actor, intent }) {
    const t = world.get(intent.target!);
    const who = world.get(actor);
    const weapon = weaponOf(world, actor);
    const hp = Math.max(0, t.traits.vitals!.hp - weapon.damage);
    world.setProp(t.id, "vitals.hp", hp);
    const scope = roomScope(world, actor);
    const using = weapon.thing ? ` with ${the(weapon.thing)}` : "";
    const events: EventDraft[] = [
      {
        name: "attacked",
        scope,
        actor,
        target: t.id,
        text: `${cap(the(who))} hits ${the(t)}${using}.`,
        you: `You hit ${the(t)}${using} for ${weapon.damage}.`,
        data: { damage: weapon.damage, hp },
      },
    ];
    if (hp === 0) {
      for (const item of world.children(t.id)) world.move(item.id, world.roomOf(t.id));
      events.push({ name: "died", scope, actor: t.id, target: t.id, text: `${cap(the(t))} collapses.`, you: "Everything goes dark." });
    }
    return { events };
  },
};

const say: Verb = {
  name: "say",
  summary: "Speak aloud. Everyone in the room hears you, and some may answer.",
  usage: "say <words>   (or just start with ')",
  freeText: true,
  // Free text: players type it, golems speak through their reasoning model. Never a plain option.
  options: () => [],
  check: ({ intent }) => (intent.text?.trim() ? null : "Say what?"),
  perform({ world, actor, intent }) {
    const who = world.get(actor);
    const text = intent.text!.trim();
    return {
      events: [{ name: "said", scope: roomScope(world, actor), actor, text: `${cap(the(who))} says: "${text}"`, you: `You say: "${text}"`, data: { words: text } }],
    };
  },
};

const wait: Verb = {
  name: "wait",
  summary: "Do nothing for a moment.",
  usage: "wait",
  aliases: ["z"],
  options: (_world, actor) => [option(actor, "wait", undefined, "wait", "Do nothing for a moment.")],
  check: () => null,
  perform: () => ({ events: [] }),
};

export const standardVerbs: Verb[] = [look, go, take, drop, toggle("open", true), toggle("close", false), unlock, attack, say, wait];
