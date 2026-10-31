import type { Condition, Effect, Id, Scenario, Thing } from "@claywork/clay";
import { flagsRead, references } from "@claywork/glyphs";
import { Wheel } from "@claywork/wheel";

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
  for (const [flag, at] of flagsUsed) if (!flagsWritten.has(flag)) error("flag-never-set", `Reads flag "${flag}", which nothing ever sets.`, at);

  for (const t of scenario.things) {
    if (t.traits.exit?.hidden && !revealed.has(t.id)) warn("secret-never-revealed", `Hidden exit "${t.id}" is never revealed by any trigger.`, t.id);
  }

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
    const failed = events.find((e) => e.actor === kiln && e.name === "failed");
    const acted = events.some((e) => e.actor === kiln && e.name !== "failed");
    if (failed) {
      cracks.push({ severity: "error", code: "step-failed", message: `Step "${describe(step)}" failed: ${failed.text}`, at });
      break;
    }
    if (!acted && step.verb !== "wait") {
      const said = events.filter((e) => e.name === "narration").map((e) => e.text).join(" ");
      cracks.push({ severity: "error", code: "step-blocked", message: `Step "${describe(step)}" was blocked.${said ? ` The world said: ${said}` : ""}`, at });
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
