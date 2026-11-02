// Minds for the Clay Arena. With REFLEX_URL set, every golem fights with the real System One
// model; with REASON_URL set, Pebble's calm moments come from a real chat model (Qwen). Without
// them, fakes stand in, so the arena is playable and testable offline.
import { FakeReflex, reflexFromEnv, type FakeRule } from "@claywork/reflex";
import { FakeReason, reasonFromEnv } from "@claywork/reason";
import type { Minds } from "@claywork/golems";

/** A stand-in for the chat model: a few clay-hound gestures, chosen by what just happened. */
const calmFake = () =>
  new FakeReason((req) => {
    // react to the latest thing noticed, as a real model would weigh it most
    let latest = "";
    try {
      latest = (JSON.parse(req.messages.at(-1)?.content ?? "{}") as { noticed?: string[] }).noticed?.at(-1) ?? "";
    } catch {}
    if (/pets you/.test(latest)) return '{"do": "emote", "text": "leans into your hand and rumbles like a cooling kiln"}';
    if (/says:/.test(latest)) return '{"do": "emote", "text": "tilts its head and thumps its stubby clay tail"}';
    if (/kills/.test(latest)) return '{"do": "emote", "text": "sniffs the heap of dust, then sneezes"}';
    return '{"do": "nothing"}';
  }, { latencyMs: 300 });

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
    reason: reasonFromEnv() ?? calmFake(),
    deadlineMs: Number(process.env.REFLEX_DEADLINE_MS ?? (real ? 1500 : 800)),
  };
}
