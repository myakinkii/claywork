import { test } from "node:test";
import assert from "node:assert/strict";
import { World, type Thing } from "@claywork/clay";

const things: Thing[] = [
  { id: "room", name: "room", location: null, traits: { room: {} } },
  { id: "hero", name: "Hero", location: "room", traits: { actor: { kind: "player" } } },
  { id: "chest", name: "chest", location: "room", traits: { container: {}, openable: { open: false } } },
  { id: "key", name: "key", location: "chest", traits: { takeable: {} } },
  { id: "jar", name: "glass jar", location: "room", traits: { container: { transparent: true } } },
  { id: "bug", name: "bug", location: "jar", traits: {} },
];

test("containment: roomOf walks up, isInside sees nesting", () => {
  const w = new World({ things });
  assert.equal(w.roomOf("key"), "room");
  assert.ok(w.isInside("key", "room"));
  assert.ok(!w.isInside("room", "key"));
});

test("move refuses containment cycles", () => {
  const w = new World({ things });
  assert.throws(() => w.move("chest", "key"), /cycle/);
  assert.throws(() => w.move("chest", "chest"), /cycle/);
});

test("closed opaque containers hide their contents, transparent ones don't", () => {
  const w = new World({ things });
  const ids = () => w.reachable("hero").map((t) => t.id).sort();
  assert.deepEqual(ids(), ["bug", "chest", "jar"]);
  w.setProp("chest", "openable.open", true);
  assert.deepEqual(ids(), ["bug", "chest", "jar", "key"]);
});

test("props by path, snapshots are independent copies", () => {
  const w = new World({ things, flags: { a: 1 } });
  assert.equal(w.prop("chest", "openable.open"), false);
  w.setProp("chest", "lightable.lit", true);
  assert.equal(w.prop("chest", "lightable.lit"), true);
  const snap = w.snapshot();
  w.move("key", "hero");
  assert.equal(snap.things.find((t) => t.id === "key")!.location, "chest");
  assert.deepEqual(snap.flags, { a: 1 });
});

test("the world does not mutate the scenario it was made from", () => {
  const w = new World({ things });
  w.move("key", "hero");
  assert.equal(things.find((t) => t.id === "key")!.location, "chest");
});
