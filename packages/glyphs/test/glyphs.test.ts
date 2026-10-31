import { test } from "node:test";
import assert from "node:assert/strict";
import { World, type Trigger } from "@claywork/clay";
import { apply, check, fire, references } from "@claywork/glyphs";

const world = () =>
  new World({
    things: [
      { id: "room", name: "room", location: null, traits: { room: {} } },
      { id: "hero", name: "Hero", location: "room", traits: { actor: {}, vitals: { hp: 5, maxHp: 10 } } },
      { id: "gem", name: "gem", location: "hero", traits: {} },
      { id: "gap", name: "gap", location: "room", traits: { exit: { to: "room", hidden: true } } },
    ],
    flags: { lit: true },
  });

test("conditions", () => {
  const w = world();
  const ctx = { world: w, actor: "hero", target: "gem" };
  assert.ok(check({ has: ["$actor", "$target"] }, ctx));
  assert.ok(check({ flag: "lit" }, ctx));
  assert.ok(!check({ flag: "lit", equals: false }, ctx));
  assert.ok(check({ prop: ["hero", "vitals.hp"], gt: 4, lt: 6 }, ctx));
  assert.ok(check({ all: [{ actorIs: "hero" }, { not: { at: ["gem", "room"] } }] }, ctx));
  assert.ok(check({ any: [{ flag: "nope" }, { at: ["hero", "room"] }] }, ctx));
});

test("effects mutate the world and narrate to the room", () => {
  const w = world();
  const res = apply([{ move: ["$target", "room"] }, { reveal: "gap" }, { setFlag: "done" }, { say: "Clink." }], { world: w, actor: "hero", target: "gem" });
  assert.equal(w.get("gem").location, "room");
  assert.equal(w.prop("gap", "exit.hidden"), false);
  assert.equal(w.flags.get("done"), true);
  assert.deepEqual(res.events.map((e) => [e.name, e.scope]), [["narration", { kind: "room", room: "room" }]]);
});

test("triggers: phase, target, else, once, block", () => {
  const w = world();
  const fired = new Set<string>();
  const triggers: Trigger[] = [
    { id: "guard", on: "take", phase: "before", target: "gem", if: [{ flag: "cursed" }], then: [{ block: true }], else: [{ say: "ok" }] },
    { id: "once", on: "take", target: "gem", once: true, then: [{ setFlag: "taken" }] },
  ];
  const ctx = { world: w, actor: "hero", target: "gem" };
  assert.equal(fire(triggers, { on: "take", phase: "before" }, ctx, fired).blocked, false);
  w.flags.set("cursed", true);
  assert.equal(fire(triggers, { on: "take", phase: "before" }, ctx, fired).blocked, true);
  fire(triggers, { on: "take", phase: "after" }, ctx, fired);
  w.flags.delete("taken");
  fire(triggers, { on: "take", phase: "after" }, ctx, fired);
  assert.equal(w.flags.get("taken"), undefined, "once triggers fire once");
});

test("references lists literal ids only", () => {
  assert.deepEqual(references({ all: [{ has: ["$actor", "gem"] }, { prop: ["door", "openable.open"], equals: true }] }), ["gem", "door"]);
  assert.deepEqual(references({ move: ["$target", "box"] }), ["box"]);
});
