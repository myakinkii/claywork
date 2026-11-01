import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { loadScenario } from "@claywork/clay";
import { Wheel } from "@claywork/wheel";
import { FakeReflex } from "@claywork/reflex";
import { FakeReason } from "@claywork/reason";
import { MUTTER, animate, brute, reflexPolicy, voice, type Policy } from "@claywork/golems";

const cellarWithAnnaDownstairs = () => {
  const wheel = new Wheel(loadScenario(new URL("../../../worlds/drowned-cellar.json", import.meta.url)));
  wheel.join({ id: "anna", name: "Anna" });
  wheel.submit({ actor: "anna", verb: "go", target: "stairs_down" });
  wheel.turn();
  return wheel;
};

/** Turn the wheel and give async minds a moment to answer before the next turn. */
async function turns(wheel: Wheel, n: number, gapMs = 5) {
  for (let i = 0; i < n; i++) {
    wheel.turn();
    await sleep(gapMs);
  }
}

test("a reflex golem fights, with rules scripting the fake model", async () => {
  const wheel = cellarWithAnnaDownstairs();
  const reflex = new FakeReflex({
    rules: [({ key }) => (key === "action" ? { "attack:anna": 4 } : undefined)],
  });
  const goblin = animate(wheel, "goblin", { policy: reflexPolicy(reflex) });
  await turns(wheel, 3);
  goblin.stop();
  assert.ok(wheel.world.get("anna").traits.vitals!.hp < 20, "the goblin hit Anna");
  assert.equal(goblin.stats.fallbacks, 0);
});

test("an unsure model falls back to rules", async () => {
  const wheel = cellarWithAnnaDownstairs();
  const decisions: string[] = [];
  const goblin = animate(wheel, "goblin", {
    policy: reflexPolicy(new FakeReflex({ temperature: 0 }), { fallback: brute() }),
    onDecision: (d) => decisions.push(d.why ?? ""),
  });
  await turns(wheel, 2);
  goblin.stop();
  assert.match(decisions[0]!, /unsure .* brute: enemy in reach/);
});

test("the wheel never waits: a slow mind misses its deadline and the fallback acts", async () => {
  const wheel = cellarWithAnnaDownstairs();
  const slow: Policy = { name: "slow", decide: (_dp, signal) => new Promise((_r, reject) => signal.addEventListener("abort", () => reject(signal.reason))) };
  const goblin = animate(wheel, "goblin", { policy: slow, fallback: brute(), deadlineMs: 20 });
  wheel.turn();
  await sleep(40);
  wheel.turn();
  goblin.stop();
  assert.equal(goblin.stats.timeouts, 1);
  assert.equal(wheel.world.get("anna").traits.vitals!.hp, 18, "brute attacked with the dagger");
});

test("illegal choices are caught and replaced", async () => {
  const wheel = cellarWithAnnaDownstairs();
  const liar: Policy = { name: "liar", decide: async () => ({ option: "teleport:moon" }) };
  const goblin = animate(wheel, "goblin", { policy: liar });
  await turns(wheel, 2);
  goblin.stop();
  assert.equal(goblin.stats.errors, 2, "one per turn");
  assert.equal(goblin.stats.fallbacks, 2);
  assert.equal(wheel.world.get("goblin").location, "cellar", "no teleporting to the moon");
});

test("a golem with a voice answers when spoken to, in character", async () => {
  const wheel = cellarWithAnnaDownstairs();
  const reason = new FakeReason(["Shiny things first, then you pass."]);
  const mouth = voice(wheel, "goblin", reason);
  wheel.submit({ actor: "anna", verb: "say", text: "Let me through." });
  await turns(wheel, 2);
  mouth.stop();
  assert.match(reason.requests[0]!.system!, /cowardly but greedy goblin/);
  assert.ok(wheel.slip.log.some((e) => e.actor === "goblin" && e.name === "said" && /Shiny/.test(e.text)));
});

test("a voice can mutter on its own, for whoever is listening", async () => {
  const wheel = cellarWithAnnaDownstairs();
  const reason = new FakeReason((req) => (req.messages.at(-1)!.content === MUTTER ? "Nobody looks in the chest." : "Go away!"));
  const mouth = voice(wheel, "goblin", reason, { mutter: { everyTicks: 2 } });
  await turns(wheel, 4);
  mouth.stop();
  const said = wheel.slip.log.filter((e) => e.actor === "goblin" && e.name === "said");
  assert.ok(said.length >= 1);
  assert.match(said[0]!.text, /Nobody looks in the chest/);
  assert.ok(reason.requests.every((r) => !r.messages.some((m) => m.content === MUTTER && r.messages.indexOf(m) < r.messages.length - 1)), "mutter prompts are not remembered as conversation");
});
