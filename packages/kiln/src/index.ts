import type { ArtRef, Condition, Effect, Id, Scenario, Sprite, Thing } from "@claywork/clay";
import { flagsRead, references } from "@claywork/glyphs";
import { Wheel, standardVerbs } from "@claywork/wheel";

export interface Crack {
  severity: "error" | "warning";
  code: string;
  message: string;
  /** Where: a thing id, trigger id, or walkthrough step. */
  at?: string;
}

export interface Firing {
  ok: boolean;
  cracks: Crack[];
}

/**
 * Fire a scenario. The heat reveals the cracks: broken references, impossible
 * containment, unreachable rooms, unused secrets, and finally whether the
 * walkthrough actually wins. Only scenarios with no errors should go live.
 *
 * The cracks are written to be fed straight back to the Potter (the generating
 * LLM) so it can repair its own output.
 */
export function fire(scenario: Scenario): Firing {
  const cracks: Crack[] = [];
  const error = (code: string, message: string, at?: string) => cracks.push({ severity: "error", code, message, ...(at ? { at } : {}) });
  const warn = (code: string, message: string, at?: string) => cracks.push({ severity: "warning", code, message, ...(at ? { at } : {}) });

  // --- identity and references ----------------------------------------------
  const byId = new Map<Id, Thing>();
  for (const t of scenario.things) {
    if (byId.has(t.id)) error("duplicate-id", `Two things share the id "${t.id}".`, t.id);
    byId.set(t.id, t);
  }
  const exists = (id: Id) => byId.has(id);
  const isRoom = (id: Id) => Boolean(byId.get(id)?.traits.room);

  for (const t of scenario.things) {
    if (t.location !== null && !exists(t.location)) error("missing-location", `"${t.id}" is located in "${t.location}", which does not exist.`, t.id);
    const exit = t.traits.exit;
    if (exit) {
      if (!exists(exit.to)) error("missing-destination", `Exit "${t.id}" leads to "${exit.to}", which does not exist.`, t.id);
      else if (!isRoom(exit.to)) error("destination-not-room", `Exit "${t.id}" leads to "${exit.to}", which is not a room.`, t.id);
      if (t.location === null || !isRoom(t.location)) error("exit-not-in-room", `Exit "${t.id}" must be located directly in a room.`, t.id);
    }
    const echo = t.traits.echo;
    if (echo) {
      if (!t.traits.room) error("echo-not-room", `"${t.id}" has an echo but is not a room.`, t.id);
      if (!isRoom(echo.from)) error("echo-from-nowhere", `"${t.id}" hears "${echo.from}", which is not a room.`, t.id);
      else if (echo.from === t.id) warn("echo-self", `"${t.id}" echoes itself.`, t.id);
    }
    if (t.traits.dark && !t.traits.room) warn("dark-not-room", `"${t.id}" is dark but not a room; darkness only applies to rooms.`, t.id);
    const key = t.traits.lockable?.key;
    if (key && !exists(key)) error("missing-key", `"${t.id}" is locked by "${key}", which does not exist.`, t.id);
    if (t.traits.lockable?.locked && !key) warn("no-key", `"${t.id}" is locked and has no key; only a glyph can open it.`, t.id);
    if (t.traits.lockable && !t.traits.openable) warn("lock-without-door", `"${t.id}" is lockable but not openable.`, t.id);
  }

  // --- containment ------------------------------------------------------------
  for (const t of scenario.things) {
    const seen = new Set<Id>([t.id]);
    let at = t.location;
    while (at !== null && exists(at)) {
      if (seen.has(at)) {
        error("containment-cycle", `"${t.id}" is (indirectly) inside itself.`, t.id);
        break;
      }
      seen.add(at);
      at = byId.get(at)!.location;
    }
  }

  if (!exists(scenario.spawn)) error("missing-spawn", `Spawn room "${scenario.spawn}" does not exist.`);
  else if (!isRoom(scenario.spawn)) error("spawn-not-room", `Spawn "${scenario.spawn}" is not a room.`);

  // --- glyphs -----------------------------------------------------------------
  const triggers = scenario.triggers ?? [];
  const triggerIds = new Set<string>();
  const flagsWritten = new Set(Object.keys(scenario.flags ?? {}));
  const flagsUsed = new Map<string, string>();
  const revealed = new Set<Id>();

  const checkRefs = (node: Condition | Effect, at: string) => {
    for (const ref of references(node)) if (!exists(ref)) error("missing-reference", `Refers to "${ref}", which does not exist.`, at);
  };

  for (const trig of triggers) {
    const at = `trigger:${trig.id}`;
    if (triggerIds.has(trig.id)) error("duplicate-trigger", `Two triggers share the id "${trig.id}".`, at);
    triggerIds.add(trig.id);
    if (trig.target && !exists(trig.target)) error("missing-reference", `Targets "${trig.target}", which does not exist.`, at);
    if (trig.on === "enter" && trig.target && !isRoom(trig.target)) error("enter-not-room", `"enter" triggers must target a room.`, at);
    for (const cond of trig.if ?? []) {
      checkRefs(cond, at);
      for (const f of flagsRead(cond)) flagsUsed.set(f, at);
    }
    const effects = [...trig.then, ...(trig.else ?? [])];
    for (const effect of effects) {
      checkRefs(effect, at);
      if ("setFlag" in effect) flagsWritten.add(effect.setFlag);
      if ("reveal" in effect) {
        const target = byId.get(effect.reveal);
        if (target && !target.traits.exit) error("reveal-not-exit", `Reveals "${effect.reveal}", which is not an exit.`, at);
        revealed.add(effect.reveal);
      }
      if ("block" in effect && (trig.phase ?? "after") !== "before") warn("block-after", `"block" only works in "before" triggers.`, at);
    }
  }
  if (scenario.goal) {
    checkRefs(scenario.goal, "goal");
    for (const f of flagsRead(scenario.goal)) flagsUsed.set(f, "goal");
  } else {
    warn("no-goal", "The scenario has no goal; it can never be completed.");
  }

  for (const t of scenario.things) {
    if (t.traits.exit?.hidden && !revealed.has(t.id)) warn("secret-never-revealed", `Hidden exit "${t.id}" is never revealed by any trigger.`, t.id);
  }

  // --- verbs ------------------------------------------------------------------
  const verbConfig = scenario.verbs ?? {};
  const engine = new Set(standardVerbs.map((v) => v.name));
  const known = new Set([...engine].filter((v) => verbConfig[v] !== false));
  for (const [name, config] of Object.entries(verbConfig)) {
    const at = `verb:${name}`;
    if (config === false) {
      if (name === "wait") error("wait-disabled", `"wait" cannot be switched off: every actor must always be able to let time pass.`, at);
      else if (!engine.has(name)) warn("disable-unknown", `Switches off "${name}", which is not a standard verb.`, at);
      continue;
    }
    known.add(name);
    for (const req of config.requires ?? []) {
      for (const cond of [req.if, req.unless]) {
        if (!cond) continue;
        checkRefs(cond, at);
        for (const f of flagsRead(cond)) flagsUsed.set(f, at);
      }
      if (!req.fail) warn("silent-requirement", `A requirement has no "fail" message; players will get a generic refusal.`, at);
    }
    if (engine.has(name)) {
      if (config.appliesTo || config.text || config.you || config.phrase) warn("ignored-config", `"${name}" is a standard verb; appliesTo, phrase, text and you only apply to world verbs.`, at);
      continue;
    }
    if (!config.summary) warn("no-summary", `World verb "${name}" has no summary, so /help can't explain it.`, at);
    for (const id of config.appliesTo?.ids ?? []) if (!exists(id)) error("missing-reference", `Applies to "${id}", which does not exist.`, at);
    const trait = config.appliesTo?.trait;
    const everything = [...scenario.things, ...(scenario.player?.companions ?? [])];
    if (trait && !everything.some((t) => t.traits[trait] !== undefined)) warn("applies-to-nothing", `Applies to things with trait "${trait}", but nothing has it.`, at);
    // nothing: "" says the answer comes from elsewhere (a golem's mind), so no triggers is fine
    if (!triggers.some((t) => t.on === name) && config.nothing !== "") warn("meaningless-verb", `World verb "${name}" has no triggers, so it can only ever say "Nothing happens."`, at);
  }
  for (const trig of triggers) {
    if (trig.on !== "enter" && !known.has(trig.on)) error("unknown-verb", `Triggers on "${trig.on}", which is not a verb in this world.`, `trigger:${trig.id}`);
  }
  for (const [i, step] of (scenario.walkthrough ?? []).entries()) {
    if (!known.has(step.verb)) error("unknown-verb", `Uses "${step.verb}", which is not a verb in this world.`, `walkthrough:${i + 1}`);
  }

  for (const [flag, at] of flagsUsed) if (!flagsWritten.has(flag)) error("flag-never-set", `Reads flag "${flag}", which nothing ever sets.`, at);

  // --- minds ------------------------------------------------------------------
  const archetypes = scenario.archetypes ?? {};
  const ROLES = new Set(["self", "master", "servant", "ally", "foe", "other"]);
  const usedArchetypes = new Set<string>();
  const actors = [...scenario.things, ...(scenario.player?.companions ?? [])];
  for (const t of actors) {
    const a = t.traits.actor;
    if (!a) continue;
    if (a.archetype) {
      usedArchetypes.add(a.archetype);
      if (!(a.archetype in archetypes)) error("missing-archetype", `"${t.id}" thinks with archetype "${a.archetype}", which is not defined.`, t.id);
    }
    if (a.serves !== undefined) {
      if (a.serves === t.id) error("serves-self", `"${t.id}" serves itself.`, t.id);
      else if (!byId.get(a.serves)?.traits.actor) error("serves-nobody", `"${t.id}" serves "${a.serves}", which is not an actor.`, t.id);
    }
  }
  for (const c of scenario.player?.companions ?? []) {
    if (!c.traits.actor) error("companion-not-actor", `Companion "${c.id}" has no actor trait.`, `companion:${c.id}`);
    if (c.traits.actor?.serves) warn("companion-serves", `Companion "${c.id}" sets "serves"; it is always set to the joining player.`, `companion:${c.id}`);
  }
  const BEHAVIOR_WORDS: [verb: string, pattern: RegExp, words: string][] = [
    ["attack", /\battack/i, "attack"],
    ["go", /\brun away\b/i, "run away"],
    ["wait", /\bstay\b/i, "stay"],
  ];
  for (const [id, arc] of Object.entries(archetypes)) {
    const at = `archetype:${id}`;
    if (!usedArchetypes.has(id)) warn("unused-archetype", `Archetype "${id}" is used by no actor.`, at);
    if (!arc.phases?.length) error("no-phases", `Archetype "${id}" has no phases, so no goal.`, at);
    else if (arc.phases.every((p) => p.when)) warn("no-default-phase", `Every phase of "${id}" has a condition; when none holds, the last one is used anyway.`, at);
    for (const phase of arc.phases ?? []) if (phase.when) checkRefs(phase.when, `${at}:${phase.id}`);
    for (const v of arc.repertoire ?? []) if (!known.has(v)) error("unknown-verb", `Repertoire of "${id}" has "${v}", which is not a verb in this world.`, at);
    for (const f of arc.forbid ?? []) {
      const [v, role] = f.split(":");
      if (!v || !role || !known.has(v) || !ROLES.has(role)) error("bad-forbid", `Forbidden move "${f}" should be verb:role, e.g. "attack:master".`, at);
    }
    for (const r of arc.hears ?? []) if (!ROLES.has(r)) error("bad-role", `"${id}" hears "${r}", which is not a role (${[...ROLES].join(", ")}).`, at);
    if (arc.calm && !arc.calm.goal?.trim()) error("empty-calm", `"${id}" has a calm mode with no goal.`, at);
    // Goals ask for behaviors in the options' words; asking for one the repertoire lacks is a crack.
    for (const phase of arc.phases ?? []) {
      for (const [v, pattern, words] of BEHAVIOR_WORDS) {
        if (pattern.test(phase.goal) && !arc.repertoire.includes(v) && !/\bnever\b/i.test(phase.goal.split(/[.!]/).find((s) => pattern.test(s)) ?? "")) {
          warn("goal-beyond-repertoire", `Phase "${phase.id}" of "${id}" asks to "${words}", but "${v}" is not in its repertoire.`, at);
        }
      }
    }
  }

  // --- art --------------------------------------------------------------------
  const sprites = scenario.art ?? {};
  const usedArt = new Set<string>();
  const useArt = (id: string, at: string) => {
    usedArt.add(id);
    if (!(id in sprites)) error("missing-art", `Shows sprite "${id}", which is not in the art library.`, at);
  };
  for (const [id, sprite] of Object.entries(sprites)) for (const c of checkSprite(sprite)) cracks.push({ ...c, at: `art:${id}` });
  for (const t of scenario.things) {
    if (t.art === undefined) continue;
    for (const id of artIds(t.art)) useArt(id, t.id);
    if (typeof t.art !== "string") for (const v of t.art.when ?? []) checkRefs(v.if, t.id);
  }
  for (const trig of triggers) {
    for (const effect of [...trig.then, ...(trig.else ?? [])]) if ("say" in effect && effect.art) useArt(effect.art, `trigger:${trig.id}`);
  }
  for (const id of Object.keys(sprites)) if (!usedArt.has(id)) warn("unused-art", `Sprite "${id}" is never shown.`, `art:${id}`);

  // --- reachability (ignoring locks, counting revealable secrets) -------------
  if (isRoom(scenario.spawn)) {
    const reached = new Set<Id>([scenario.spawn]);
    const frontier = [scenario.spawn];
    while (frontier.length) {
      const room = frontier.pop()!;
      for (const t of scenario.things) {
        const exit = t.traits.exit;
        if (t.location !== room || !exit || !isRoom(exit.to) || reached.has(exit.to)) continue;
        if (exit.hidden && !revealed.has(t.id)) continue;
        reached.add(exit.to);
        frontier.push(exit.to);
      }
    }
    for (const t of scenario.things) {
      if (t.traits.room && !reached.has(t.id)) error("unreachable-room", `Room "${t.id}" cannot be reached from the spawn.`, t.id);
    }
  }

  // --- the walkthrough: does it actually win? --------------------------------
  const structural = cracks.some((c) => c.severity === "error");
  if (!scenario.walkthrough?.length) {
    warn("no-walkthrough", "No walkthrough given, so the scenario is not proven winnable.");
  } else if (!structural) {
    cracks.push(...simulate(scenario));
  }

  return { ok: !cracks.some((c) => c.severity === "error"), cracks };
}

/** The limits keep art legible in an 80 column terminal (two pixel rows per text line). */
export const ART_LIMITS = { width: 64, height: 64 };

/** Well-formed pixel art: even rows, known colors, within the limits. */
export function checkSprite(sprite: Sprite): Crack[] {
  const cracks: Crack[] = [];
  const error = (code: string, message: string) => cracks.push({ severity: "error", code, message });
  if (!sprite.rows?.length) {
    error("empty-art", "The sprite has no rows.");
    return cracks;
  }
  const w = sprite.rows[0]!.length;
  if (sprite.rows.some((r) => r.length !== w)) error("ragged-art", `Rows must all be ${w} characters wide; some are not.`);
  if (w > ART_LIMITS.width || sprite.rows.length > ART_LIMITS.height) {
    error("art-too-big", `${w}x${sprite.rows.length} is larger than ${ART_LIMITS.width}x${ART_LIMITS.height}.`);
  }
  for (const [key, color] of Object.entries(sprite.palette ?? {})) {
    if (key.length !== 1 || key === ".") error("bad-palette-key", `Palette keys are single characters other than "."; "${key}" is not.`);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) error("bad-color", `"${key}" is "${color}", which is not a #rrggbb color.`);
  }
  const unknown = new Set<string>();
  for (const row of sprite.rows) for (const ch of row) if (ch !== "." && !(ch in (sprite.palette ?? {}))) unknown.add(ch);
  if (unknown.size) error("unknown-color", `Characters with no palette color: ${[...unknown].map((c) => JSON.stringify(c)).join(", ")}.`);
  return cracks;
}

function artIds(ref: ArtRef): string[] {
  return typeof ref === "string" ? [ref] : [ref.default, ...(ref.when ?? []).map((v) => v.use)];
}

/**
 * Play the walkthrough on a real wheel, one intent per turn. Other actors stay idle:
 * this proves the puzzle chain is solvable, not that the fights are fair.
 */
export function simulate(scenario: Scenario): Crack[] {
  const cracks: Crack[] = [];
  const wheel = new Wheel(scenario);
  const kiln = "__kiln__";
  try {
    wheel.join({ id: kiln, name: "Kiln", hp: 1_000_000 });
  } catch (e) {
    return [{ severity: "error", code: "join-failed", message: `A player could not join: ${(e as Error).message}` }];
  }
  for (const [i, step] of (scenario.walkthrough ?? []).entries()) {
    const at = `walkthrough:${i + 1}`;
    let events;
    try {
      wheel.submit({ ...step, actor: kiln });
      events = wheel.turn();
    } catch (e) {
      cracks.push({ severity: "error", code: "engine-error", message: `Step "${describe(step)}" crashed the engine: ${(e as Error).message}`, at });
      break;
    }
    const outcome = wheel.outcome(kiln);
    if (outcome !== "done") {
      const said = events.map((e) => e.text).join(" ");
      const code = outcome === "blocked" ? "step-blocked" : outcome === "unable" ? "step-unable" : "step-failed";
      cracks.push({ severity: "error", code, message: `Step "${describe(step)}" was ${outcome ?? "not resolved"}.${said ? ` The world said: ${said}` : ""}`, at });
      break;
    }
  }
  if (!cracks.length && !wheel.hasWon(kiln)) {
    cracks.push({ severity: "error", code: "goal-not-reached", message: "The walkthrough completed but the goal was not reached." });
  }
  return cracks;
}

function describe(step: { verb: string; target?: string; with?: string }): string {
  return [step.verb, step.target, step.with ? `with ${step.with}` : ""].filter(Boolean).join(" ");
}
