import { test } from "node:test";
import assert from "node:assert/strict";
import { loadScenario, type Scenario } from "@claywork/clay";
import { Wheel } from "@claywork/wheel";

const cellar = () => loadScenario(new URL("../../../worlds/drowned-cellar.json", import.meta.url));

/** Put Anna in the crypt with the goblin dead and the door open, the quick way. */
function inCrypt(scenario: Scenario = cellar()) {
  const wheel = new Wheel(scenario);
  wheel.join({ id: "anna", name: "Anna" });
  wheel.world.move("anna", "crypt");
  wheel.world.remember("anna", "sight:crypt"); // skip the first-sight cut scene: these tests are about verbs
  wheel.world.setProp("goblin", "vitals.hp", 0);
  const act = (verb: string, target?: string, extra: object = {}) => {
    wheel.submit({ actor: "anna", verb, ...(target ? { target } : {}), ...extra });
    return wheel.turn().filter((e) => e.actor === "anna" || e.scope.kind !== "global");
  };
  return { wheel, act };
}

test("world verbs exist only in their world, and say where they come from", () => {
  const { wheel } = inCrypt();
  const pray = wheel.verbs().find((v) => v.name === "pray")!;
  assert.equal(pray.origin, "world");
  assert.equal(pray.usage, "pray at <thing>");
  assert.equal(wheel.verbs().find((v) => v.name === "take")!.origin, "engine");
  assert.ok(wheel.options("anna").some((o) => o.label === "pray at stone altar"));

  const plain = cellar();
  delete plain.verbs;
  assert.ok(!new Wheel(plain).verbs().some((v) => v.name === "pray"));
});

test("a world verb announces itself and glyphs give it meaning", () => {
  const { act } = inCrypt();
  const texts = act("pray", "altar").map((e) => e.you ?? e.text);
  assert.deepEqual(texts, ["You kneel before the stone altar and pray.", "Under your palms the altar hums, and the heart on it beats a little faster."]);
});

test("when no glyph answers, nothing happens", () => {
  const { wheel, act } = inCrypt();
  wheel.world.move("clay_heart", "cellar");
  assert.equal(act("pray", "altar").at(-1)!.text, "The stone is cold and silent.");
});

test("inability fails with flavor, and the option is still offered", () => {
  const { wheel, act } = inCrypt();
  act("take", "clay_heart");
  assert.ok(wheel.world.hasTrait("anna", "mute"));
  const [e] = act("say", undefined, { text: "Hello?" });
  assert.equal(e!.name, "unable");
  assert.equal(e!.text, "You open your mouth, and nothing comes out.");
  assert.equal(wheel.outcome("anna"), "unable");

  act("pray", "altar");
  assert.ok(!wheel.world.hasTrait("anna", "mute"), "praying with the heart gives the voice back");
  assert.equal(act("say", undefined, { text: "Thank you." })[0]!.name, "said");
});

test("stillness counts only chosen, consecutive waiting", () => {
  const { wheel, act } = inCrypt();
  const moved = () => wheel.world.flags.get("figures_moved") === true;
  act("wait");
  act("wait");
  act("look");
  assert.equal(wheel.world.prop("anna", "actor.still"), 0, "looking breaks stillness");
  act("wait");
  act("wait");
  wheel.turn(); // idle: no intent, so stillness neither grows nor breaks
  assert.ok(!moved());
  const events = act("wait");
  assert.ok(moved());
  assert.match(events.at(-1)!.text, /one step closer/);
});

test("worlds can switch verbs off, but never wait", () => {
  const s = cellar();
  s.verbs = { ...s.verbs, attack: false };
  const wheel = new Wheel(s);
  assert.ok(!wheel.verbs().some((v) => v.name === "attack"));
  s.verbs = { wait: false };
  assert.throws(() => new Wheel(s), /cannot be switched off/);
});

test("worlds can re-describe standard verbs and template their players", () => {
  const s = cellar();
  s.verbs = { ...s.verbs, take: { summary: "Pocket it, if it fits.", aliases: ["pocket"] } };
  s.player = { hp: 7, traits: { mute: {} } };
  const wheel = new Wheel(s);
  const take = wheel.verbs().find((v) => v.name === "take")!;
  assert.equal(take.summary, "Pocket it, if it fits.");
  assert.deepEqual(take.aliases, ["get", "grab", "pocket"]);
  wheel.join({ id: "anna", name: "Anna" });
  assert.equal(wheel.world.get("anna").traits.vitals!.hp, 7);
  assert.ok(wheel.world.hasTrait("anna", "mute"));
});
