import { test } from "node:test";
import assert from "node:assert/strict";
import { Choice, FakeReflex, Noul, Score, confidence, getChoice, getNoul, getScore } from "@claywork/reflex";

test("confidence: 1 when certain, 0 when even, codelab formula for three", () => {
  assert.equal(confidence([1, 0, 0]), 1);
  assert.equal(confidence([1 / 3, 1 / 3, 1 / 3]), 0);
  assert.ok(Math.abs(confidence([0.6, 0.3, 0.1]) - (3 * 0.6 - 1) / 2) < 1e-9);
});

test("the fake answers every question type with a valid shape", async () => {
  const reflex = new FakeReflex();
  const res = await reflex.ask({
    state: { telegraph: "The ogre raises its club high overhead." },
    questions: {
      response: Choice("What is the right response?", {
        block_high: "Raise the shield against an overhead or high swing.",
        block_low: "Shield down against a sweep at the legs.",
        wait: "Do nothing.",
      }),
      danger: Score("How hard will it hit?", ["None.", "Light.", "Heavy."]),
      exposed: Noul("Is the opponent exposed?"),
    },
  });
  const response = getChoice(res, "response");
  assert.equal(response.choice, "block_high", "word overlap: overhead / high");
  assert.ok(Math.abs(Object.values(response.probabilities).reduce((a, b) => a + b) - 1) < 1e-9);
  const danger = getScore(res, "danger");
  assert.ok(danger.score >= 0 && danger.score <= 2);
  assert.equal(getNoul(res, "exposed").noul, 0.5);
});

test("rules script sharper behaviour", async () => {
  const reflex = new FakeReflex({
    rules: [({ key, text }) => (key === "act" && text.includes("hurt") ? { flee: 5, fight: 0 } : undefined), ({ key }) => (key === "yes" ? 0.9 : undefined)],
  });
  const res = await reflex.ask({ state: "badly hurt", questions: { act: Choice("?", { flee: "Run.", fight: "Hit." }), yes: Noul("?") } });
  assert.equal(getChoice(res, "act").choice, "flee");
  assert.ok(getChoice(res, "act").confidence > 0.9);
  assert.equal(getNoul(res, "yes").noul, 0.9);
});

test("latency is simulated and abortable", async () => {
  const reflex = new FakeReflex({ latencyMs: 200 });
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("deadline")), 10);
  await assert.rejects(reflex.ask({ state: "", questions: {} }, { signal: controller.signal }), /deadline/);
});
