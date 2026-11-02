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

/** Fresh minds per instance, so every party's goblin keeps its own memory. */
export default function minds(): Minds {
  const real = reflexFromEnv();
  let muttered = 0;
  const fakeVoice = new FakeReason(
    (req) => (req.system?.includes("mutter to yourself") ? JSON.stringify({ do: "say", text: mutters[muttered++ % mutters.length] }) : '{"do": "nothing"}'),
    { latencyMs: 300 },
  );
  return {
    reflex: real ?? new FakeReflex({ latencyMs: [60, 300], rules: [instincts] }),
    reason: reasonFromEnv() ?? fakeVoice,
    // A real model is a network call away: give it more room than the fake needs.
    deadlineMs: Number(process.env.REFLEX_DEADLINE_MS ?? (real ? 1500 : 800)),
  };
}
