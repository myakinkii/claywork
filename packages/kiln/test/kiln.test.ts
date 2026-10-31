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
  assert.equal(crack.at, "walkthrough:5");
});

test("a walkthrough that stops short does not reach the goal", () => {
  const s = cellar();
  s.walkthrough = s.walkthrough!.slice(0, -1);
  assert.deepEqual(codes(s), ["goal-not-reached"]);
});
