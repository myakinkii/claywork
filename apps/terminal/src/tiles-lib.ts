import { readFileSync } from "node:fs";
import type { Effect, Id, Intent, Scenario } from "@claywork/clay";
import { apply } from "@claywork/glyphs";
import { Wheel } from "@claywork/wheel";
import { getChoice, type Reflex } from "@claywork/reflex";
import { mindQuestion, mindView, orders, type MindView } from "@claywork/golems";

/**
 * Test tiles: before glazing a pot, potters fire small tiles to see how a glaze really
 * behaves. A tile builds a situation in the real world (intents and glyph edits), lets the
 * engine render what one golem perceives, and checks what the decision model chooses.
 */
export interface TileFile {
  /** The player joining before setup; companions join with them. */
  player?: { id: string; name: string };
  tiles: Tile[];
}

export type Step = { do: Intent } | Effect;

export interface Tile {
  id: string;
  /** The golem being tested. */
  actor: Id;
  setup?: Step[];
  /** Acceptable choices: option ids, or a prefix ending in ":" ("go:" = any way out). */
  expect: string | string[];
  /** Choices that must never be made. */
  avoid?: string[];
  /** Below this, the engine would act on its fallback instead. Default 0.4, the trust threshold. */
  minConfidence?: number;
  note?: string;
}

export interface TileResult {
  tile: Tile;
  pass: boolean;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  view?: MindView;
  error?: string;
}

const matches = (choice: string, pattern: string) => (pattern.endsWith(":") ? choice.startsWith(pattern) : choice === pattern);

export async function fireTile(scenario: Scenario, file: TileFile, tile: Tile, reflex: Reflex): Promise<TileResult> {
  try {
    const wheel = new Wheel(scenario);
    const player = file.player ?? { id: "max", name: "Max" };
    wheel.join(player);
    if (!wheel.world.has(tile.actor)) throw new Error(`no actor "${tile.actor}"`);
    const archetypeId = wheel.world.get(tile.actor).traits.actor?.archetype;
    const archetype = archetypeId ? scenario.archetypes?.[archetypeId] : undefined;
    if (!archetype) throw new Error(`"${tile.actor}" has no archetype`);
    const heard = orders(wheel, tile.actor, archetype);
    for (const step of tile.setup ?? []) {
      if ("do" in step) {
        wheel.submit(step.do);
        wheel.turn();
        const outcome = wheel.outcome(step.do.actor);
        if (outcome && outcome !== "done") throw new Error(`setup step ${JSON.stringify(step.do)} was ${outcome}`);
      } else {
        apply([step], { world: wheel.world, actor: player.id });
      }
    }
    const h = heard.current();
    const view = mindView(wheel, tile.actor, archetype, wheel.decisionPoint(tile.actor), h ? { heard: h } : {});
    heard.stop();
    let choice: string, confidence: number, probabilities: Record<string, number>;
    if (view.options.length <= 1) {
      // decided by structure alone: nothing to ask
      choice = view.options[0]?.id ?? "none";
      confidence = 1;
      probabilities = { [choice]: 1 };
    } else {
      const res = await reflex.ask({ state: view.state, questions: mindQuestion(view) });
      const a = getChoice(res, "action");
      ({ choice, confidence, probabilities } = a);
    }
    const expected = Array.isArray(tile.expect) ? tile.expect : [tile.expect];
    const ok =
      expected.some((p) => matches(choice, p)) &&
      !(tile.avoid ?? []).some((p) => matches(choice, p)) &&
      confidence >= (tile.minConfidence ?? 0.4);
    return { tile, pass: ok, choice, confidence, probabilities, view };
  } catch (e) {
    return { tile, pass: false, error: (e as Error).message };
  }
}

export function loadTiles(path: string | URL): TileFile {
  return JSON.parse(readFileSync(path, "utf8")) as TileFile;
}
