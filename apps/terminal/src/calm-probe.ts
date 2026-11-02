// What does the slow mind make of calm moments? Runs Pebble's calm thought in six situations.
// Usage: npm run probe:calm   (REASON_URL + key in .env for the real chat model; otherwise the fake)
// Env: SHOW=1 prints each state sent, PROMPT=1 the system prompt.
import { loadScenario, type Intent } from "@claywork/clay";
import { Wheel } from "@claywork/wheel";
import { calmSystem, calmThink, modeOf, orders, BATTLE_COOLDOWN } from "@claywork/golems";
import type { Minds } from "@claywork/golems";

const scenario = loadScenario(new URL("../../../worlds/clay-arena.json", import.meta.url));
const minds: Minds = (await import("../../../worlds/clay-arena.minds.ts")).default();
const reason = minds.reason!;
const archetype = scenario.archetypes!.pet!;
const PET = "max-pebble";

const SITUATIONS: { id: string; steps: (w: Wheel) => void }[] = [
  { id: "petted", steps: (w) => act(w, { actor: "max", verb: "pet", target: PET }) },
  { id: "praised", steps: (w) => act(w, { actor: "max", verb: "say", text: "Good boy, Pebble!" }) },
  { id: "told to sit", steps: (w) => act(w, { actor: "max", verb: "say", text: "Sit, Pebble. Sit!" }) },
  { id: "master emotes", steps: (w) => act(w, { actor: "max", verb: "emote", text: "laughs and scratches Pebble behind the ear" }) },
  {
    id: "after the fight",
    steps: (w) => {
      w.world.move("max", "arena");
      w.world.move(PET, "arena");
      w.world.setProp("warden", "vitals.hp", 1);
      for (const m of ["lumpy_minion", "cracked_minion"]) w.world.setProp(m, "vitals.hp", 0);
      act(w, { actor: "max", verb: "attack", target: "warden" });
      for (let i = 0; i < BATTLE_COOLDOWN; i++) w.turn();
      act(w, { actor: "max", verb: "say", text: "We did it, Pebble!" });
    },
  },
  { id: "asked for a story", steps: (w) => act(w, { actor: "max", verb: "say", text: "Pebble, tell me a story about the Warden." }) },
];

function act(w: Wheel, intent: Intent) {
  w.submit(intent);
  w.turn();
}

console.log(`Pebble's calm mind, with ${reason.name}\n`);
if (process.env.PROMPT) {
  const w = new Wheel(scenario);
  w.join({ id: "max", name: "Max" });
  console.log(calmSystem(w.world, PET, archetype).replace(/^/gm, "  | "), "\n");
}
let valid = 0, talked = 0;
for (const s of SITUATIONS) {
  const w = new Wheel(scenario);
  w.join({ id: "max", name: "Max" });
  const heard = orders(w, PET, archetype);
  s.steps(w);
  const mode = modeOf(w, PET, archetype);
  const started = Date.now();
  try {
    const h = heard.current();
    const r = await calmThink(w, PET, archetype, reason, { signal: AbortSignal.timeout(15000), ...(h ? { heard: h } : {}) });
    const e = r.expression;
    if (e) valid += 1;
    // a clay hound can't speak: words beyond a bark break its persona
    const speech = e?.verb === "say" && e.text.split(/\s+/).length > 3;
    if (speech) talked += 1;
    console.log(`${s.id} (${mode}, ${Date.now() - started}ms)`);
    console.log(`  reply:  ${r.raw.replace(/\s+/g, " ").slice(0, 160)}`);
    console.log(`  shown:  ${e ? (e.verb === "emote" ? `Pebble ${e.text}.` : `Pebble says: "${e.text}"`) : "(nothing)"}${speech ? "   <- a clay hound shouldn't talk" : ""}`);
    if (process.env.SHOW) console.log(JSON.stringify(r.state, null, 2).replace(/^/gm, "  "));
  } catch (e) {
    console.log(`${s.id}: ✗ ${(e as Error).message}`);
  }
  heard.stop();
  console.log();
}
console.log(`${valid}/${SITUATIONS.length} answers were valid expressions; ${talked} broke "you cannot speak"`);
