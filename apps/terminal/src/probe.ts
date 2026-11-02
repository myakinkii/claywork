// Ask the configured System One model what the goblin would do, and show everything.
// Usage: npm run probe   (needs REFLEX_URL and a key, see .env.example)
import { loadScenario } from "@claywork/clay";
import { Wheel } from "@claywork/wheel";
import { reflexFromEnv, type Reflex, type ReflexRequest, type ReflexResponse } from "@claywork/reflex";
import { brute, reflexPolicy } from "@claywork/golems";

const real = reflexFromEnv();
if (!real) {
  console.error("No REFLEX_URL set. Copy .env.example to .env and fill it in, then run: npm run probe");
  process.exit(1);
}

/** Wraps the real model to keep the last request and response for display. */
let last: { request: ReflexRequest; response?: ReflexResponse; error?: Error } | undefined;
const recording: Reflex = {
  name: real.name,
  async ask(request, options) {
    last = { request };
    try {
      last.response = await real.ask(request, options);
      return last.response;
    } catch (e) {
      last.error = e as Error;
      throw e;
    }
  },
};

const wheel = new Wheel(loadScenario(new URL("../../../worlds/drowned-cellar.json", import.meta.url)));
wheel.join({ id: "anna", name: "Anna" });
wheel.world.move("anna", "cellar");
wheel.world.learn("anna", "old_shovel");
wheel.world.move("old_shovel", "anna");
const policy = reflexPolicy(recording, { fallback: brute() });

async function probe(title: string) {
  console.log(`\n=== ${title} ===`);
  const dp = wheel.decisionPoint("goblin");
  const started = Date.now();
  try {
    const decision = await policy.decide(dp, AbortSignal.timeout(5000));
    const r = last!.response!;
    console.log("state sent:", JSON.stringify(last!.request.state, null, 2));
    console.log("\noptions (with the hints the model reads):");
    const action = r.answers.action;
    for (const o of dp.options) {
      const p = action?.type === "choice" ? action.probabilities[o.id] ?? 0 : 0;
      console.log(`  ${(p * 100).toFixed(1).padStart(5)}%  ${o.id.padEnd(22)} ${o.hint}`);
    }
    const danger = r.answers.danger, deliberate = r.answers.deliberate;
    console.log(`\ndanger: ${danger?.type === "score" ? danger.score.toFixed(2) : "?"} of 2   deliberate: ${deliberate?.type === "noul" ? deliberate.noul.toFixed(2) : "?"}`);
    console.log(`decision: ${decision.option}  (${decision.why})`);
    console.log(`model ${r.latencyMs.toFixed(0)}ms, round trip ${Date.now() - started}ms, ${r.inputTokens ?? "?"} input tokens, request ${r.requestId ?? "?"}`);
  } catch (e) {
    console.error(`✗ ${(last?.error ?? (e as Error)).message}`);
    process.exitCode = 1;
  }
}

await probe("The goblin, healthy, Anna in front of it with a shovel");
wheel.world.setProp("goblin", "vitals.hp", 2);
wheel.slip.publish({ tick: wheel.tick, name: "attacked", scope: { kind: "room", room: "cellar" }, actor: "anna", target: "goblin", text: "Anna hits the goblin with the old shovel.", them: "Anna hits you with the old shovel for 4." });
wheel.slip.publish({ tick: wheel.tick, name: "attacked", scope: { kind: "room", room: "cellar" }, actor: "anna", target: "goblin", text: "Anna hits the goblin with the old shovel.", them: "Anna hits you with the old shovel for 2." });
await probe("The goblin, badly hurt (hp 2/8), after two hits");
