import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadScenario, type Scenario } from "@claywork/clay";
import { fire, type Crack } from "@claywork/kiln";
import type { Minds } from "@claywork/golems";

export interface ShelvedWorld {
  id: string;
  scenario: Scenario;
  /** Makes fresh minds for each instance. Absent: inhabitants use rules only. */
  minds?: () => Minds;
}

export interface Rejected {
  file: string;
  cracks: Crack[];
}

/**
 * Load every world in a directory: <id>.json, plus an optional <id>.minds.ts whose
 * default export makes the inhabitants' minds. Only worlds that fire clean are shelved.
 */
export async function loadWorlds(dir: string): Promise<{ shelf: ShelvedWorld[]; rejected: Rejected[] }> {
  const shelf: ShelvedWorld[] = [];
  const rejected: Rejected[] = [];
  // <id>.json are worlds; <id>.tiles.json are their test tiles, not worlds
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".tiles.json")).sort()) {
    const scenario = loadScenario(join(dir, file));
    const { ok, cracks } = fire(scenario);
    if (!ok) {
      rejected.push({ file, cracks: cracks.filter((c) => c.severity === "error") });
      continue;
    }
    const mindsFile = join(dir, file.replace(/\.json$/, ".minds.ts"));
    const world: ShelvedWorld = { id: scenario.id, scenario };
    if (existsSync(mindsFile)) {
      const mod = (await import(pathToFileURL(mindsFile).href)) as { default: () => Minds };
      world.minds = mod.default;
    }
    shelf.push(world);
  }
  return { shelf, rejected };
}
