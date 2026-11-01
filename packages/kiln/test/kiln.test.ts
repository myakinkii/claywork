import { test } from "node:test";
import assert from "node:assert/strict";
import { loadScenario, type Scenario } from "@claywork/clay";
import { fire } from "@claywork/kiln";

const cellar = () => loadScenario(new URL("../../../worlds/drowned-cellar.json", import.meta.url));
const codes = (s: Scenario) => fire(s).cracks.map((c) => c.code);

test("the drowned cellar fires without cracks", () => {
  const firing = fire(cellar());
  assert.deepEqual(firing.cracks, []);
  assert.ok(firing.ok);
});

test("broken references are errors", () => {
  const s = cellar();
  s.things.find((t) => t.id === "rusty_key")!.location = "nowhere";
  s.triggers!.push({ id: "bad", on: "take", target: "ghost", then: [{ move: ["phantom", "cellar"] }] });
  const c = codes(s);
  assert.ok(c.includes("missing-location"));
  assert.ok(c.filter((x) => x === "missing-reference").length >= 2);
  assert.ok(!fire(s).ok);
});

test("unreachable rooms and unrevealed secrets", () => {
  const s = cellar();
  s.triggers = s.triggers!.filter((t) => t.id !== "brick_secret");
  const c = codes(s);
  assert.ok(c.includes("secret-never-revealed"));
  assert.ok(c.includes("unreachable-room"));
});

test("flags read but never set", () => {
  const s = cellar();
  s.goal = { all: [s.goal!, { flag: "moon_is_full" }] };
  assert.ok(codes(s).includes("flag-never-set"));
});

test("a walkthrough that gets blocked is reported with the world's words", () => {
  const s = cellar();
  s.walkthrough = s.walkthrough!.filter((step) => step.verb !== "attack");
  const firing = fire(s);
  const crack = firing.cracks.find((c) => c.code === "step-blocked");
  assert.ok(crack, JSON.stringify(firing.cracks));
  assert.match(crack.message, /goblin hisses/);
  assert.equal(crack.at, `walkthrough:${s.walkthrough!.findIndex((step) => step.verb === "unlock") + 1}`);
});

test("a walkthrough that stops short does not reach the goal", () => {
  const s = cellar();
  s.walkthrough = s.walkthrough!.slice(0, s.walkthrough!.findIndex((step) => step.target === "clay_heart"));
  assert.deepEqual(codes(s), ["goal-not-reached"]);
});

test("verb configuration is checked", () => {
  const s = cellar();
  s.verbs = { ...s.verbs, wait: false, dance: { summary: "Dance." }, sing: { summary: "Sing.", appliesTo: { trait: "stage" } } };
  s.triggers!.push({ id: "juggle", on: "juggle", then: [{ say: "Whee." }] });
  const c = codes(s);
  assert.ok(c.includes("wait-disabled"));
  assert.ok(c.includes("meaningless-verb"), "dance has no triggers");
  assert.ok(c.includes("applies-to-nothing"), "nothing is a stage");
  assert.ok(c.includes("unknown-verb"), "juggle is not a verb here");
});

test("switching off a verb the walkthrough needs is caught before simulation", () => {
  const s = cellar();
  s.verbs = { ...s.verbs, attack: false };
  const c = codes(s);
  assert.ok(c.includes("unknown-verb"));
  assert.ok(!c.includes("step-blocked"), "structural errors stop the simulation");
});

test("an inability in the walkthrough is reported as such", () => {
  const s = cellar();
  // Skip the prayer that returns the voice: the final "say" must then fail.
  const heart = s.walkthrough!.findIndex((step) => step.target === "clay_heart");
  s.walkthrough!.splice(heart + 1, 1);
  const crack = fire(s).cracks.find((c) => c.code === "step-unable");
  assert.ok(crack);
  assert.match(crack.message, /nothing comes out/);
});

test("echoes must come from real rooms", () => {
  const s = cellar();
  s.things.find((t) => t.id === "niche")!.traits.echo = { from: "attic" };
  assert.ok(codes(s).includes("echo-from-nowhere"));
});

test("art is fired too: shape, colors, references", () => {
  const s = cellar();
  s.art!.broken = { palette: { A: "red", "..": "#ffffff" }, rows: ["AAB", "AA"] };
  s.things.find((t) => t.id === "torch")!.art = "flame";
  const c = codes(s);
  for (const code of ["ragged-art", "bad-color", "bad-palette-key", "unknown-color", "missing-art", "unused-art"]) assert.ok(c.includes(code), code);
  s.art!.huge = { palette: { A: "#000000" }, rows: Array(70).fill("A".repeat(80)) };
  assert.ok(codes(s).includes("art-too-big"));
});
