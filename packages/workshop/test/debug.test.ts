import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Workshop, createDebug, loadWorlds } from "@claywork/workshop";

test("debug topics: all, a list, or nothing", () => {
  assert.equal(createDebug(undefined).on("events"), false);
  assert.equal(createDebug("all").on("golems"), true);
  assert.equal(createDebug("1").on("net"), true);
  const some = createDebug("events, golems");
  assert.deepEqual([some.on("events"), some.on("golems"), some.on("net")], [true, true, false]);
});

test("debug shows the world unfiltered: events, intents, sessions", async () => {
  const lines: string[] = [];
  const debug = createDebug("all", (l) => lines.push(l));
  const { shelf } = await loadWorlds(fileURLToPath(new URL("../../../worlds/", import.meta.url)));
  const ws = new Workshop(shelf, { tickMs: 0, debug, token: () => "secret-token" });
  const session = ws.connect(() => {});
  ws.receive(session, { type: "start", world: "drowned-cellar", name: "Anna" });
  ws.receive(session, { type: "command", text: "search" });
  ws.instances.get("i1")!.wheel.turn();
  ws.close();

  const text = lines.join("\n");
  assert.match(text, /net\s+new session secr…/);
  assert.doesNotMatch(text, /secret-token/, "tokens are never logged in full");
  assert.match(text, /net\s+Anna \(secr…\) started drowned-cellar as i1, playing i1-p1/);
  assert.match(text, /intents \[i1 t0\] i1-p1 wants to search/);
  assert.match(text, /events\s+\[i1 t1\] searched i1-p1 \[room stairwell\] Anna searches the room\./);
});
