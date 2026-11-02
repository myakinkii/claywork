// Minds for the Clay Arena. With REFLEX_URL set, every golem decides with the real System
// One model through its archetype. Without it, a fake with simple instincts stands in, so
// the arena is playable and testable offline. The fake matches words, as the real one mostly does.
import { FakeReflex, reflexFromEnv, type FakeRule } from "@claywork/reflex";
import type { Minds } from "@claywork/golems";

const instincts: FakeRule = ({ question, state }) => {
  if (question.type !== "choice") return undefined;
  const s = state as { goal?: string; noticed?: string[]; heard?: string };
  const ids = Object.keys(question.criteria);
  const pick = (id: string | undefined) => (id ? Object.fromEntries(ids.map((k) => [k, k === id ? 4 : 0])) : undefined);
  const said = (s.heard ?? [...(s.noticed ?? [])].reverse().find((l) => /^Your master .* says:/.test(l)))?.toLowerCase();
  if (said?.includes("stay")) return pick(ids.find((k) => k === "wait"));
  if (said?.includes("attack")) {
    // the attack option sharing the most words with the order
    const words = (k: string) => question.criteria[k]!.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !["your", "attack", "foe"].includes(w) && said.includes(w)).length;
    const named = ids.filter((k) => k.startsWith("attack:")).sort((a, b) => words(b) - words(a))[0];
    if (named && words(named) > 0) return pick(named);
  }
  if (s.goal?.includes("Run away") && s.goal.includes("dead")) return pick(ids.find((k) => k.startsWith("go:")));
  // answer whoever just attacked us or ours: the last "Your foe X attacks you / your master / your servant"
  const attacker = [...(s.noticed ?? [])].reverse()
    .map((l) => /^Your foe,? (?:the )?(.+?),? attacks (?:you|your master|your servant)/.exec(l)?.[1]?.toLowerCase())
    .find(Boolean);
  const answer = attacker && ids.find((k) => k.startsWith("attack:") && question.criteria[k]!.toLowerCase().includes(attacker));
  return pick(answer || ids.find((k) => k.startsWith("attack:")) || "wait");
};

export default function minds(): Minds {
  const real = reflexFromEnv();
  return {
    reflex: real ?? new FakeReflex({ latencyMs: [40, 160], rules: [instincts] }),
    deadlineMs: Number(process.env.REFLEX_DEADLINE_MS ?? (real ? 1500 : 800)),
  };
}
