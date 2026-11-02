// What does a creature's slow mind make of calm moments?
// Usage: npm run probe:calm [-- worlds/clay-arena.json | worlds/drowned-cellar.json]
// REASON_URL + key in .env for the real chat model; otherwise the world's fake.
// Env: SHOW=1 prints each state sent, PROMPT=1 the system prompt.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadScenario, type Intent, type Scenario } from "@claywork/clay";
import { Wheel } from "@claywork/wheel";
import { calmSystem, calmThink, modeOf, orders, BATTLE_COOLDOWN, type Minds } from "@claywork/golems";

interface Situation {
  id: string;
  steps: (w: Wheel) => void;
  /** a quiet moment: nothing new happened, the creature mutters if it likes */
  idle?: boolean;
  /** keep the previous situation's world: the creature remembers what it just said */
  continues?: boolean;
}

function act(w: Wheel, intent: Intent) {
  w.submit(intent);
  w.turn();
}

const SETS: Record<string, { actor: string; player: { id: string; name: string }; situations: Situation[] }> = {
  "clay-arena": {
    actor: "max-pebble",
    player: { id: "max", name: "Max" },
    situations: [
      { id: "petted", steps: (w) => act(w, { actor: "max", verb: "pet", target: "max-pebble" }) },
      { id: "praised", steps: (w) => act(w, { actor: "max", verb: "say", text: "Good boy, Pebble!" }) },
      { id: "told to sit", steps: (w) => act(w, { actor: "max", verb: "say", text: "Sit, Pebble. Sit!" }) },
      { id: "master emotes", steps: (w) => act(w, { actor: "max", verb: "emote", text: "laughs and scratches Pebble behind the ear" }) },
      {
        id: "after the fight",
        steps: (w) => {
          w.world.move("max", "arena");
          w.world.move("max-pebble", "arena");
          w.world.setProp("warden", "vitals.hp", 1);
          for (const m of ["lumpy_minion", "cracked_minion"]) w.world.setProp(m, "vitals.hp", 0);
          act(w, { actor: "max", verb: "attack", target: "warden" });
          for (let i = 0; i < BATTLE_COOLDOWN; i++) w.turn();
          act(w, { actor: "max", verb: "say", text: "We did it, Pebble!" });
        },
      },
      { id: "asked for a story", steps: (w) => act(w, { actor: "max", verb: "say", text: "Pebble, tell me a story about the Warden." }) },
    ],
  },
  "drowned-cellar": {
    actor: "goblin",
    player: { id: "anna", name: "Anna" },
    situations: [
      // Anna listens from the niche; the goblin is alone in the cellar and mutters
      { id: "alone, muttering (1)", idle: true, steps: (w) => w.world.move("anna", "niche") },
      { id: "alone, muttering (2)", idle: true, continues: true, steps: () => {} },
      { id: "alone, muttering (3)", idle: true, continues: true, steps: () => {} },
      { id: "alone, muttering (4)", idle: true, continues: true, steps: () => {} },
    ],
  },
};

const path = resolve(process.argv[2] ?? "worlds/clay-arena.json");
const scenario: Scenario = loadScenario(path);
const set = SETS[scenario.id];
if (!set) {
  console.error(`No calm situations for "${scenario.id}" yet; there are: ${Object.keys(SETS).join(", ")}`);
  process.exit(1);
}
const minds: Minds = ((await import(pathToFileURL(path.replace(/\.json$/, ".minds.ts")).href)) as { default: () => Minds }).default();
const reason = minds.reason!;
const actor = set.actor;
const archetype = scenario.archetypes![scenario.things.find((t) => t.id === actor)?.traits.actor?.archetype ?? scenario.player?.companions?.[0]?.traits.actor?.archetype ?? ""]!;

console.log(`${actor}'s calm mind in "${scenario.title}", with ${reason.name}\n`);
let w = new Wheel(scenario);
w.join(set.player);
if (process.env.PROMPT) console.log(calmSystem(w.world, actor, archetype, { idle: set.situations.some((s) => s.idle) }).replace(/^/gm, "  | "), "\n");

let valid = 0, talked = 0;
const seen = new Set<string>();
for (const s of set.situations) {
  if (!s.continues) {
    w = new Wheel(scenario);
    w.join(set.player);
  }
  const heard = orders(w, actor, archetype);
  s.steps(w);
  const mode = modeOf(w, actor, archetype);
  const started = Date.now();
  try {
    const h = heard.current();
    const r = await calmThink(w, actor, archetype, reason, { signal: AbortSignal.timeout(15000), ...(s.idle ? { idle: true } : {}), ...(h ? { heard: h } : {}) });
    const e = r.expression;
    if (e) {
      valid += 1;
      seen.add(e.text);
      // let it happen, so the next thought knows what was just said
      w.submit({ actor, verb: e.verb, text: e.text });
      w.turn();
    }
    // a clay hound can't speak: words beyond a bark break its persona
    const speech = actor === "max-pebble" && e?.verb === "say" && e.text.split(/\s+/).length > 3;
    if (speech) talked += 1;
    const name = w.world.get(actor).name;
    console.log(`${s.id} (${mode}, ${Date.now() - started}ms)`);
    console.log(`  reply:  ${r.raw.replace(/\s+/g, " ").slice(0, 180)}`);
    console.log(`  shown:  ${e ? (e.verb === "emote" ? `${name} ${e.text}.` : `${name} says: "${e.text}"`) : "(nothing)"}${speech ? "   <- a clay hound shouldn't talk" : ""}`);
    if (process.env.SHOW) console.log(JSON.stringify(r.state, null, 2).replace(/^/gm, "  "));
  } catch (err) {
    console.log(`${s.id}: ✗ ${(err as Error).message}`);
  }
  heard.stop();
  console.log();
}
console.log(`${valid}/${set.situations.length} valid expressions, ${seen.size} different ones${actor === "max-pebble" ? `; ${talked} broke "you cannot speak"` : ""}`);
