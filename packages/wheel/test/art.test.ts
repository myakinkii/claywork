import { test } from "node:test";
import assert from "node:assert/strict";
import { loadScenario } from "@claywork/clay";
import { Wheel } from "@claywork/wheel";

const cellar = () => loadScenario(new URL("../../../worlds/drowned-cellar.json", import.meta.url));

function setup() {
  const wheel = new Wheel(cellar());
  wheel.join({ id: "anna", name: "Anna" });
  const act = (verb: string, target?: string, extra: object = {}) => {
    wheel.submit({ actor: "anna", verb, ...(target ? { target } : {}), ...extra });
    return wheel.turn();
  };
  const art = (events: { art?: string }[]) => events.map((e) => e.art).filter(Boolean);
  const looked = (events: { name: string; art?: string }[]) => art(events.filter((e) => e.name === "looked"));
  return { wheel, act, art, looked };
}

test("first sight of a room is a cut scene, once per player, and not in the dark", () => {
  const { wheel, act, art } = setup();
  assert.deepEqual(art(act("search")), [], "the stairwell is dark and has no art");
  const down = act("go", "stairs_down");
  assert.deepEqual(art(down), ["cellar", "goblin"], "the cellar, then the goblin in it");
  assert.equal(down.find((e) => e.art === "goblin")!.text, "A wiry goblin with a chipped dagger, standing guard in front of the iron door.");
  act("go", "stairs_up");
  assert.deepEqual(art(act("go", "stairs_down")), [], "you remember it now");
});

test("every player gets their own first time", () => {
  const { wheel, act, art } = setup();
  act("go", "stairs_down");
  wheel.join({ id: "bob", name: "Bob" });
  wheel.submit({ actor: "bob", verb: "go", target: "stairs_down" });
  const events = wheel.turn();
  assert.deepEqual(events.filter((e) => e.scope.kind === "actor" && e.scope.actor === "bob").map((e) => e.art).filter(Boolean), ["cellar", "goblin"]);
});

test("looking at a thing shows the art for its current state", () => {
  const { wheel, act, looked } = setup();
  wheel.world.move("anna", "cellar");
  assert.deepEqual(looked(act("look", "iron_chest")), ["chest_closed"]);
  act("open", "iron_chest");
  assert.deepEqual(looked(act("look", "iron_chest")), ["chest_open"]);
  act("take", "rusty_key");
  assert.deepEqual(looked(act("look", "iron_chest")), ["chest_empty"], "no key glinting once you have it");
});

test("story beats carry their art, and the crypt remembers what happened", () => {
  const { wheel, act, art } = setup();
  wheel.world.move("anna", "crypt");
  assert.deepEqual(art(act("wait")), ["crypt"]);
  act("wait");
  assert.deepEqual(art(act("wait")), ["figures_closer"], "three ticks of stillness");
  assert.deepEqual(art(act("take", "clay_heart")), ["figures_turn"]);

  wheel.join({ id: "bob", name: "Bob" });
  wheel.world.move("bob", "crypt");
  const bob = wheel.turn().filter((e) => e.scope.kind === "actor" && e.scope.actor === "bob");
  assert.deepEqual(bob.map((e) => e.art), ["figures_turn"], "Bob arrives after the heart is gone: they are already watching");
});

test("pictures need eyes: in the dark you get the words without the art", () => {
  const { wheel } = setup();
  wheel.world.move("anna", "crypt");
  wheel.world.learn("anna", "clay_heart"); // she felt for it before her sight went
  wheel.world.grant("anna", "blind");
  wheel.submit({ actor: "anna", verb: "take", target: "clay_heart" });
  wheel.turn();
  const moment = wheel.slip.recent("anna", 10).find((e) => /turns its head/.test(e.text))!;
  assert.equal(moment.art, undefined);
  assert.equal(wheel.slip.log.find((e) => /turns its head/.test(e.text))!.art, "figures_turn", "the event itself still has it");
});
