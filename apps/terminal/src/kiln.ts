// Fire a scenario and print its cracks. Usage: npm run kiln [-- worlds/some-world.json]
import { resolve } from "node:path";
import { loadScenario } from "@claywork/clay";
import { fire } from "@claywork/kiln";

const path = resolve(process.argv[2] ?? "worlds/drowned-cellar.json");
const scenario = loadScenario(path);
const { ok, cracks } = fire(scenario);

console.log(`Firing "${scenario.title}" (${path})`);
for (const c of cracks) console.log(`  ${c.severity === "error" ? "✗" : "!"} [${c.code}]${c.at ? ` ${c.at}:` : ""} ${c.message}`);
console.log(ok ? `✓ fired clean${cracks.length ? ` with ${cracks.length} warning(s)` : ""}` : `✗ cracked`);
process.exit(ok ? 0 : 1);
