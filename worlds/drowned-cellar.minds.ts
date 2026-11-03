// Minds for the Drowned Cellar. The goblin thinks with its archetype: in a fight with the
// System One decision model (REFLEX_URL), and alone with a chat model (REASON_URL) that
// mutters its secrets for anyone listening through the wall. Without them, fakes stand in,
// so tests and offline play keep working.
import { FakeReflex, reflexFromEnv, type FakeRule } from "@claywork/reflex";
import { FakeReason, reasonFromEnv } from "@claywork/reason";
import type { Minds } from "@claywork/golems";

/**
 * Fake instincts, reading the goblin's mind view as the real model would: run when the
 * "You are badly hurt!" alert is up and a way out exists, otherwise attack. A real model
 * gets the archetype's goal instead.
 */
const instincts: FakeRule = ({ question, state }) => {
  if (question.type !== "choice") return undefined;
  const alerts = (state as { alerts?: string[] }).alerts ?? [];
  const ids = Object.keys(question.criteria);
  const run = ids.find((id) => id.startsWith("go:"));
  const attack = ids.find((id) => id.startsWith("attack:"));
  const pick = alerts.includes("You are badly hurt!") && run ? run : (attack ?? "wait");
  return Object.fromEntries(ids.map((id) => [id, id === pick ? 3 : 0]));
};

/** The secrets a real model finds in the archetype's calm goal, as a fake's four lines. */
const mutters = [
  "Nobody looks in the chest. Chest is heavy. Key is safe, hehe.",
  "Goblin is not scared. Goblin is NOT scared.",
  "Warm heart, shiny heart... but master said: touch it, and it eats your voice.",
  "If they hit hard, goblin runs. Goblin always runs. Then goblin comes back.",
];

const threats = ["Mine! Go away! No shiny, no door!", "Goblin guards door. You pay shiny, or you go.", "Shiny? You have shiny? Show Goblin."];
const glee = ["Shiny! Goblin rich! Goblin buy boots!", "Friend! Friend passes. Goblin keeps shiny.", "Warm boots... no more cold water. Hehe."];

/** Fresh minds per instance, so every party's goblin keeps its own memory. */
export default function minds(): Minds {
  const real = reflexFromEnv();
  let muttered = 0, threatened = 0, gloated = 0;
  // a stand-in for the chat model, picking by what the goblin is told and what it just noticed
  const fakeVoice = new FakeReason((req) => {
    const say = (text: string) => JSON.stringify({ do: "say", text });
    if (req.system?.includes("Goblin was paid")) return say(glee[gloated++ % glee.length]!);
    if (req.system?.includes("mutter to yourself")) return say(mutters[muttered++ % mutters.length]!);
    let latest = "";
    try {
      latest = (JSON.parse(req.messages.at(-1)?.content ?? "{}") as { noticed?: string[] }).noticed?.at(-1) ?? "";
    } catch {}
    if (/^Your foe .*(arrives|says)/.test(latest)) return say(threats[threatened++ % threats.length]!);
    return '{"do": "nothing"}';
  }, { latencyMs: 300 });
  return {
    reflex: real ?? new FakeReflex({ latencyMs: [60, 300], rules: [instincts] }),
    reason: reasonFromEnv() ?? fakeVoice,
    // A real model is a network call away: give it more room than the fake needs.
    deadlineMs: Number(process.env.REFLEX_DEADLINE_MS ?? (real ? 1500 : 800)),
  };
}
