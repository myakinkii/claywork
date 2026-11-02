// Minds for the Drowned Cellar. With REFLEX_URL set (see .env.example) the goblin decides
// with a real System One model; otherwise it uses a fake with scripted instincts, so tests
// and offline play keep working. The voice is still scripted until a Reason adapter lands.
import { FakeReflex, reflexFromEnv, type FakeRule } from "@claywork/reflex";
import { FakeReason } from "@claywork/reason";
import { MUTTER, type Minds } from "@claywork/golems";

/** Fake instincts: fight while healthy, flee when badly hurt. A real model gets the persona instead. */
const instincts: FakeRule = ({ key, question, state }) => {
  if (key !== "action" || question.type !== "choice") return undefined;
  const self = (state as { self: { state: string[] } }).self;
  const hp = Number(self.state.find((s) => s.startsWith("hp "))?.slice(3).split("/")[0] ?? 99);
  const prefer = hp <= 3 ? "go:" : "attack:";
  return Object.fromEntries(Object.keys(question.criteria).map((id) => [id, id.startsWith(prefer) ? 3 : 0]));
};

const replies = ["Mine! Go away!", "Shiny things... you have shiny things?", "Door stays shut. Goblin says so."];
const mutters = [
  "Nobody looks in the chest. Chest is heavy. Key is safe, hehe.",
  "Goblin is not scared. Goblin is NOT scared.",
  "Warm heart, shiny heart... but master said: touch it, and it eats your voice.",
  "If they hit hard, goblin runs. Goblin always runs. Then goblin comes back.",
];

/** Fresh minds per instance, so every party's goblin keeps its own memory. */
export default function minds(): Minds {
  let replied = 0;
  let muttered = 0;
  const real = reflexFromEnv();
  return {
    reflex: real ?? new FakeReflex({ latencyMs: [60, 300], rules: [instincts] }),
    reason: new FakeReason(
      (req) => (req.messages.at(-1)?.content === MUTTER ? mutters[muttered++ % mutters.length]! : replies[replied++ % replies.length]!),
      { latencyMs: 400 },
    ),
    mutterEvery: 4,
    // A real model is a network call away: give it more room than the fake needs.
    deadlineMs: Number(process.env.REFLEX_DEADLINE_MS ?? (real ? 1500 : 800)),
  };
}
