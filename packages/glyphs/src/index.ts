import type { Condition, Effect, EventDraft, Id, Ref, Trigger, World } from "@claywork/clay";

/** What a glyph can see: the world and who/what the current event is about. */
export interface GlyphContext {
  world: World;
  actor?: Id;
  target?: Id;
}

export function resolve(ref: Ref, ctx: GlyphContext): Id {
  if (ref === "$actor") {
    if (!ctx.actor) throw new Error("$actor used outside of an actor context");
    return ctx.actor;
  }
  if (ref === "$target") {
    if (!ctx.target) throw new Error("$target used outside of a target context");
    return ctx.target;
  }
  return ref;
}

export function check(cond: Condition, ctx: GlyphContext): boolean {
  const { world } = ctx;
  if ("all" in cond) return cond.all.every((c) => check(c, ctx));
  if ("any" in cond) return cond.any.some((c) => check(c, ctx));
  if ("not" in cond) return !check(cond.not, ctx);
  if ("flag" in cond) {
    const value = world.flags.get(cond.flag);
    return "equals" in cond ? value === cond.equals : Boolean(value);
  }
  if ("has" in cond) {
    const [holder, thing] = cond.has;
    return world.isInside(resolve(thing, ctx), resolve(holder, ctx));
  }
  if ("at" in cond) {
    const [thing, place] = cond.at;
    return world.get(resolve(thing, ctx)).location === resolve(place, ctx);
  }
  if ("prop" in cond) {
    const [thing, path] = cond.prop;
    const value = world.prop(resolve(thing, ctx), path);
    if ("equals" in cond && value !== cond.equals) return false;
    if (cond.gt !== undefined && !(typeof value === "number" && value > cond.gt)) return false;
    if (cond.lt !== undefined && !(typeof value === "number" && value < cond.lt)) return false;
    return true;
  }
  if ("actorIs" in cond) return ctx.actor === resolve(cond.actorIs, ctx);
  if ("trait" in cond) {
    const [thing, trait] = cond.trait;
    return world.hasTrait(resolve(thing, ctx), trait);
  }
  if ("still" in cond) {
    const [actor, ticks] = cond.still;
    const still = world.prop(resolve(actor, ctx), "actor.still");
    return typeof still === "number" && still >= ticks;
  }
  throw new Error(`Unknown condition: ${JSON.stringify(cond)}`);
}

export interface Applied {
  events: EventDraft[];
  blocked: boolean;
}

/** Apply effects in order, mutating the world. Returns narration events and whether the verb was blocked. */
export function apply(effects: Effect[], ctx: GlyphContext): Applied {
  const { world } = ctx;
  const result: Applied = { events: [], blocked: false };
  for (const effect of effects) {
    if ("say" in effect) {
      const room = ctx.actor ? world.roomOf(ctx.actor) : null;
      const toActor = effect.to === "actor" || room === null;
      if (toActor && !ctx.actor) continue;
      result.events.push({
        name: "narration",
        scope: toActor ? { kind: "actor", actor: ctx.actor! } : { kind: "room", room: room! },
        text: effect.say,
      });
    } else if ("set" in effect) {
      const [thing, path, value] = effect.set;
      world.setProp(resolve(thing, ctx), path, value);
    } else if ("move" in effect) {
      const [thing, destination] = effect.move;
      world.move(resolve(thing, ctx), destination === null ? null : resolve(destination, ctx));
    } else if ("setFlag" in effect) {
      world.flags.set(effect.setFlag, effect.value ?? true);
    } else if ("reveal" in effect) {
      world.setProp(resolve(effect.reveal, ctx), "exit.hidden", false);
    } else if ("destroy" in effect) {
      world.move(resolve(effect.destroy, ctx), null);
    } else if ("grant" in effect) {
      const [thing, trait, props] = effect.grant;
      world.grant(resolve(thing, ctx), trait, props ?? {});
    } else if ("revoke" in effect) {
      const [thing, trait] = effect.revoke;
      world.revoke(resolve(thing, ctx), trait);
    } else if ("block" in effect) {
      result.blocked = true;
    } else {
      throw new Error(`Unknown effect: ${JSON.stringify(effect)}`);
    }
  }
  return result;
}

/**
 * Fire every trigger matching this verb, phase and target.
 * `fired` remembers "once" triggers across the world's lifetime.
 */
export function fire(
  triggers: readonly Trigger[],
  match: { on: string; phase: "before" | "after" },
  ctx: GlyphContext,
  fired: Set<string>,
): Applied {
  const result: Applied = { events: [], blocked: false };
  for (const trigger of triggers) {
    if (trigger.on !== match.on || (trigger.phase ?? "after") !== match.phase) continue;
    if (trigger.target !== undefined && trigger.target !== ctx.target) continue;
    if (trigger.once && fired.has(trigger.id)) continue;
    const passes = (trigger.if ?? []).every((c) => check(c, ctx));
    const effects = passes ? trigger.then : (trigger.else ?? []);
    if (effects.length === 0) continue;
    if (trigger.once && passes) fired.add(trigger.id);
    const applied = apply(effects, ctx);
    result.events.push(...applied.events);
    result.blocked ||= applied.blocked;
  }
  return result;
}

/** Every literal id a condition or effect refers to, for validation by the kiln. */
export function references(node: Condition | Effect): Id[] {
  const refs: Ref[] = [];
  const add = (...r: (Ref | null)[]) => refs.push(...(r.filter((x) => x !== null) as Ref[]));
  const walk = (n: Condition | Effect): void => {
    if ("all" in n) n.all.forEach(walk);
    else if ("any" in n) n.any.forEach(walk);
    else if ("not" in n) walk(n.not);
    else if ("has" in n) add(...n.has);
    else if ("at" in n) add(...n.at);
    else if ("prop" in n) add(n.prop[0]);
    else if ("actorIs" in n) add(n.actorIs);
    else if ("trait" in n) add(n.trait[0]);
    else if ("still" in n) add(n.still[0]);
    else if ("grant" in n) add(n.grant[0]);
    else if ("revoke" in n) add(n.revoke[0]);
    else if ("set" in n) add(n.set[0]);
    else if ("move" in n) add(...n.move);
    else if ("reveal" in n) add(n.reveal);
    else if ("destroy" in n) add(n.destroy);
  };
  walk(node);
  return refs.filter((r) => !r.startsWith("$"));
}

/** Flags a condition reads, and flags effects write, for the kiln. */
export function flagsRead(cond: Condition): string[] {
  if ("all" in cond) return cond.all.flatMap(flagsRead);
  if ("any" in cond) return cond.any.flatMap(flagsRead);
  if ("not" in cond) return flagsRead(cond.not);
  if ("flag" in cond) return [cond.flag];
  return [];
}
