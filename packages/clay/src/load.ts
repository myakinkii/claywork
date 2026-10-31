import { readFileSync } from "node:fs";
import type { Scenario } from "./types.ts";

/** Load a scenario from a JSON file. No validation here: that is the kiln's job. */
export function loadScenario(path: string | URL): Scenario {
  return JSON.parse(readFileSync(path, "utf8")) as Scenario;
}
