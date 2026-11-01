import { test } from "node:test";
import assert from "node:assert/strict";
import { loadScenario } from "@claywork/clay";
import { Wheel } from "@claywork/wheel";

const cellar = () => loadScenario(new URL("../../../worlds/drowned-cellar.json", import.meta.url));

function setup() {
  const wheel = new Wheel(cellar());
  wheel.join({ id: "anna", name: "Anna" });
  const act = (actor: string, verb: string, target?: string, extra: object = {}) => {
    wheel.submit({ actor, verb, ...(target ? { target } : {}), ...extra });
    return wheel.turn();
  };
  const heard = () => wheel.slip.recent("anna", 50).filter((e) => e.name === "overheard").map((e) => e.text);
  return { wheel, act, heard };
}

test("through the wall, speech is muffled until you listen", () => {
  const { wheel, act, heard } = setup();
  wheel.world.move("anna", "niche");
  act("goblin", "say", undefined, { text: "Nobody looks in the chest." });
  assert.deepEqual(heard(), ["Through the cracks comes a low, muffled voice. You can't make out the words."]);

  const [listened] = act("anna", "listen");
  assert.match(listened!.text, /shuffling back and forth/, "the room's sounds");
  act("goblin", "say", undefined, { text: "Nobody looks in the chest." });
  assert.equal(heard().at(-1), 'Through the wall, a voice: "Nobody looks in the chest."', "words, but not who spoke them");
});

test("listening lasts while you stay still, and breaks when you act", () => {
  const { wheel, act, heard } = setup();
  wheel.world.move("anna", "niche");
  act("anna", "listen");
  act("anna", "wait");
  act("goblin", "say", undefined, { text: "one" });
  assert.match(heard().at(-1)!, /one/);
  act("anna", "look");
  act("goblin", "say", undefined, { text: "two" });
  assert.match(heard().at(-1)!, /muffled/);
});

test("overheard events never pretend you did them, and loud things thud", () => {
  const { wheel, act, heard } = setup();
  wheel.join({ id: "bob", name: "Bob", hp: 50 });
  wheel.world.move("bob", "cellar");
  wheel.world.move("anna", "niche");
  act("goblin", "attack", "bob");
  assert.deepEqual(heard(), ["Something thuds against the other side of the wall."]);
  const event = wheel.slip.recent("anna", 1)[0]!;
  assert.equal(event.actor, undefined);
  assert.deepEqual(event.scope, { kind: "actor", actor: "anna" });
});

test("quiet things only come through when you listen", () => {
  const { wheel, act, heard } = setup();
  wheel.world.move("anna", "niche");
  act("goblin", "take", "torch");
  assert.deepEqual(heard(), []);
  act("anna", "listen");
  act("goblin", "drop", "torch");
  assert.deepEqual(heard(), ["Through the wall: The goblin drops the torch."]);
});

test("a carried light makes a dark room visible", () => {
  const { wheel, act } = setup();
  assert.equal(wheel.observe("anna").dark, true);
  wheel.world.move("torch", "anna");
  const obs = wheel.observe("anna");
  assert.equal(obs.dark, false);
  assert.deepEqual(obs.visible.map((v) => v.id), ["old_shovel", "loose_brick"], "no searching needed with a torch");
  assert.match(obs.room.description!, /crooked/);
  assert.match(act("anna", "look")[0]!.text, /Wet stone steps/);
});

test("in the dark, looking around tells you so", () => {
  const { act } = setup();
  assert.match(act("anna", "look")[0]!.text, /pitch black/);
});

test("concealed things need a search even in the light; the blind see nothing", () => {
  const s = cellar();
  s.things.push({ id: "coin", name: "silver coin", location: "cellar", traits: { takeable: {}, concealed: {} } });
  const wheel = new Wheel(s);
  wheel.join({ id: "anna", name: "Anna" });
  wheel.world.move("anna", "cellar");
  const ids = () => wheel.observe("anna").visible.map((v) => v.id);
  assert.ok(!ids().includes("coin"));
  wheel.submit({ actor: "anna", verb: "search" });
  const [found] = wheel.turn();
  assert.equal(found!.you, "You search carefully and find: silver coin.");
  assert.ok(ids().includes("coin"));

  wheel.world.grant("anna", "blind");
  assert.equal(wheel.observe("anna").dark, true);
  assert.deepEqual(ids(), ["coin"], "only what you found by touch");
});

test("knowledge is part of the world's snapshot", () => {
  const { wheel, act } = setup();
  act("anna", "search");
  assert.deepEqual(wheel.world.snapshot().known, { anna: ["old_shovel", "loose_brick"] });
});
