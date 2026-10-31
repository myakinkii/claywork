import { test } from "node:test";
import assert from "node:assert/strict";
import { loadScenario } from "@claywork/clay";
import { Wheel } from "@claywork/wheel";

const cellar = () => loadScenario(new URL("../../../worlds/drowned-cellar.json", import.meta.url));

function play(wheel: Wheel, actor: string, verb: string, target?: string, extra: object = {}) {
  wheel.submit({ actor, verb, ...(target ? { target } : {}), ...extra });
  return wheel.turn();
}

test("a player joins at spawn and sees the room, its things and exits", () => {
  const wheel = new Wheel(cellar());
  wheel.join({ id: "anna", name: "Anna" });
  const obs = wheel.observe("anna");
  assert.equal(obs.room.title, "Stairwell");
  assert.deepEqual(obs.visible.map((v) => v.id), ["old_shovel"]);
  assert.deepEqual(obs.exits.map((e) => e.direction), ["down"]);
  assert.match(obs.recent[0]!, /potter's house/);
});

test("intents only take effect on the next turn, one per actor", () => {
  const wheel = new Wheel(cellar());
  wheel.join({ id: "anna", name: "Anna" });
  wheel.submit({ actor: "anna", verb: "wait" });
  wheel.submit({ actor: "anna", verb: "take", target: "old_shovel" });
  assert.equal(wheel.world.get("old_shovel").location, "stairwell");
  wheel.turn();
  assert.equal(wheel.world.get("old_shovel").location, "anna", "the newer intent replaced the older one");
});

test("failed intents explain themselves to the actor only", () => {
  const wheel = new Wheel(cellar());
  wheel.join({ id: "anna", name: "Anna" });
  const [e] = play(wheel, "anna", "take", "clay_heart");
  assert.equal(e!.name, "failed");
  assert.deepEqual(e!.scope, { kind: "actor", actor: "anna" });
});

test("the goblin's glyph blocks the door until it is dead", () => {
  const wheel = new Wheel(cellar());
  wheel.join({ id: "anna", name: "Anna" });
  play(wheel, "anna", "take", "old_shovel");
  play(wheel, "anna", "go", "stairs_down");
  play(wheel, "anna", "open", "iron_chest");
  play(wheel, "anna", "take", "rusty_key");
  const blocked = play(wheel, "anna", "unlock", "crypt_door", { with: "rusty_key" });
  assert.equal(blocked[0]!.name, "narration");
  assert.equal(wheel.world.prop("crypt_door", "lockable.locked"), true);

  play(wheel, "anna", "attack", "goblin");
  const kill = play(wheel, "anna", "attack", "goblin");
  assert.deepEqual(kill.map((e) => e.name), ["attacked", "died"]);
  assert.equal(wheel.world.get("goblin_dagger").location, "cellar", "the dead drop what they carry");

  play(wheel, "anna", "unlock", "crypt_door", { with: "rusty_key" });
  assert.equal(wheel.world.prop("crypt_door", "lockable.locked"), false);
});

test("looking closely reveals the secret passage, once", () => {
  const wheel = new Wheel(cellar());
  wheel.join({ id: "anna", name: "Anna" });
  play(wheel, "anna", "go", "stairs_down");
  assert.ok(!wheel.options("anna").some((o) => o.id === "go:niche_passage"));
  const events = play(wheel, "anna", "look", "loose_brick");
  assert.ok(events.some((e) => e.name === "narration" && /gap opens/.test(e.text)));
  assert.ok(wheel.options("anna").some((o) => o.id === "go:niche_passage"));
  assert.equal(play(wheel, "anna", "look", "loose_brick").filter((e) => e.name === "narration").length, 0);
});

test("others in the room perceive what happens; others elsewhere do not", () => {
  const wheel = new Wheel(cellar());
  wheel.join({ id: "anna", name: "Anna" });
  wheel.join({ id: "bob", name: "Bob" });
  play(wheel, "bob", "go", "stairs_down");
  play(wheel, "anna", "take", "old_shovel");
  assert.ok(!wheel.observe("bob").recent.some((r) => r.includes("shovel")));
  assert.match(wheel.observe("anna").recent.at(-1)!, /You take the old shovel/);
});

test("options are a closed set built from verbs and traits", () => {
  const wheel = new Wheel(cellar());
  wheel.join({ id: "anna", name: "Anna" });
  const ids = wheel.options("anna").map((o) => o.id);
  assert.ok(ids.includes("take:old_shovel"));
  assert.ok(ids.includes("go:stairs_down"));
  assert.ok(ids.includes("wait"));
  for (const o of wheel.options("anna")) assert.ok(o.hint.length > 0, `${o.id} has a hint for models`);
});

test("options never include moves that can only fail", () => {
  const wheel = new Wheel(cellar());
  wheel.join({ id: "anna", name: "Anna" });
  play(wheel, "anna", "go", "stairs_down");
  const ids = wheel.options("anna").map((o) => o.id);
  assert.ok(!ids.includes("go:crypt_door"), "the door is closed");
  assert.ok(!ids.includes("open:crypt_door"), "the door is locked");
  assert.ok(ids.includes("open:iron_chest"));
});
