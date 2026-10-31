import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameEvent } from "@claywork/clay";
import { Slip, perspective } from "@claywork/slip";

const where: Record<string, string> = { anna: "hall", bob: "hall", cid: "cellar" };
const ev = (scope: GameEvent["scope"], extra: Partial<GameEvent> = {}): GameEvent => ({ tick: 1, name: "x", scope, text: "t", ...extra });

test("room events reach only actors in that room", () => {
  const slip = new Slip((id) => where[id] ?? null);
  const got: Record<string, number> = { anna: 0, cid: 0 };
  slip.subscribe(() => got.anna!++, { actor: "anna" });
  slip.subscribe(() => got.cid!++, { actor: "cid" });
  slip.publish(ev({ kind: "room", room: "hall" }));
  slip.publish(ev({ kind: "actor", actor: "cid" }));
  slip.publish(ev({ kind: "global" }));
  assert.deepEqual(got, { anna: 2, cid: 2 });
  assert.equal(slip.log.length, 3);
});

test("tracked actors remember what they perceived", () => {
  const slip = new Slip((id) => where[id] ?? null, { memory: 2 });
  slip.track("bob");
  for (let i = 0; i < 3; i++) slip.publish(ev({ kind: "room", room: "hall" }, { text: `e${i}` }));
  assert.deepEqual(slip.recent("bob").map((e) => e.text), ["e1", "e2"]);
});

test("perspective uses second person for the actor", () => {
  const e = ev({ kind: "global" }, { actor: "anna", text: "Anna waves.", you: "You wave." });
  assert.equal(perspective(e, "anna"), "You wave.");
  assert.equal(perspective(e, "bob"), "Anna waves.");
});
