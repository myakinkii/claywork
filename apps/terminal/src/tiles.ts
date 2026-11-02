// Fire a world's test tiles against its minds. Usage: npm run tiles [-- worlds/clay-arena.json]
// With REFLEX_URL set this asks the real model; otherwise the world's fake (a plumbing check).
// Env: SHOW=1 prints each state sent.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadScenario } from "@claywork/clay";
import { FakeReflex } from "@claywork/reflex";
import type { Minds } from "@claywork/golems";
import { fireTile, loadTiles } from "./tiles-lib.ts";

const worldPath = resolve(process.argv[2] ?? "worlds/clay-arena.json");
const tilesPath = worldPath.replace(/\.json$/, ".tiles.json");
const mindsPath = worldPath.replace(/\.json$/, ".minds.ts");
if (!existsSync(tilesPath)) {
  console.error(`No tiles for this world: ${tilesPath}`);
  process.exit(1);
}
const scenario = loadScenario(worldPath);
const file = loadTiles(tilesPath);
const minds: Minds = existsSync(mindsPath) ? ((await import(pathToFileURL(mindsPath).href)) as { default: () => Minds }).default() : {};
const reflex = minds.reflex ?? new FakeReflex();
console.log(`Firing ${file.tiles.length} tiles for "${scenario.title}" with ${reflex.name}\n`);

const pct = (p: number) => `${(100 * p).toFixed(0).padStart(3)}%`;
let passed = 0;
for (const tile of file.tiles) {
  const r = await fireTile(scenario, file, tile, reflex);
  if (r.pass) passed += 1;
  const expect = Array.isArray(tile.expect) ? tile.expect.join(" | ") : tile.expect;
  console.log(`${r.pass ? "✓" : "✗"} ${tile.id}`);
  if (r.error) {
    console.log(`    error: ${r.error}\n`);
    continue;
  }
  const ranked = Object.entries(r.probabilities ?? {}).sort((a, b) => b[1] - a[1]).map(([k, p]) => `${k} ${pct(p)}`).join(", ");
  console.log(`    expect ${expect}${tile.avoid ? `, never ${tile.avoid.join(" | ")}` : ""}; got ${r.choice} at ${r.confidence?.toFixed(2)}  | ${ranked}`);
  if (tile.note) console.log(`    ${tile.note}`);
  if (process.env.SHOW) console.log(JSON.stringify({ ...r.view?.state, choices: r.view?.criteria }, null, 2).replace(/^/gm, "    "));
  console.log();
}
console.log(`${passed}/${file.tiles.length} tiles fired clean`);
process.exit(passed === file.tiles.length ? 0 : 1);
