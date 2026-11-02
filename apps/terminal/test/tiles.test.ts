import { test } from "node:test";
import assert from "node:assert/strict";
import { loadScenario } from "@claywork/clay";
import { fire } from "@claywork/kiln";
import { fireTile, loadTiles } from "../src/tiles-lib.ts";

const world = (name: string) => new URL(`../../../worlds/${name}`, import.meta.url);

test("the arena fires clean, and its tiles pass with the offline fake", async () => {
  const scenario = loadScenario(world("clay-arena.json"));
  assert.deepEqual(fire(scenario).cracks.filter((c) => c.severity === "error"), []);
  const file = loadTiles(world("clay-arena.tiles.json"));
  const minds = (await import("../../../worlds/clay-arena.minds.ts")).default();
  const results = await Promise.all(file.tiles.map((t) => fireTile(scenario, file, t, minds.reflex!)));
  for (const r of results) assert.ok(r.pass, `${r.tile.id}: ${r.error ?? `got ${r.choice} at ${r.confidence}`}`);
});

test("a tile renders what the golem really sees", async () => {
  const scenario = loadScenario(world("clay-arena.json"));
  const file = loadTiles(world("clay-arena.tiles.json"));
  const tile = file.tiles.find((t) => t.id === "pet ignores a foe's command")!;
  const minds = (await import("../../../worlds/clay-arena.minds.ts")).default();
  const r = await fireTile(scenario, file, tile, minds.reflex!);
  const state = r.view!.state as { noticed: string[] };
  assert.ok(state.noticed.includes("Your foe, the Clay Warden, shouts something."));
  assert.ok(!Object.keys(r.view!.criteria).includes("attack:max"));
});

test("a broken setup is reported, not silently passed", async () => {
  const scenario = loadScenario(world("clay-arena.json"));
  const minds = (await import("../../../worlds/clay-arena.minds.ts")).default();
  const r = await fireTile(scenario, { tiles: [] }, { id: "x", actor: "max-pebble", setup: [{ do: { actor: "max", verb: "attack", target: "warden" } }], expect: "wait" }, minds.reflex!);
  assert.equal(r.pass, false);
  assert.match(r.error!, /was failed/, "Max can't reach the Warden from the antechamber");
});

test("the cellar's goblin fires its tiles with the offline fake", async () => {
  const scenario = loadScenario(world("drowned-cellar.json"));
  const file = loadTiles(world("drowned-cellar.tiles.json"));
  const minds = (await import("../../../worlds/drowned-cellar.minds.ts")).default();
  const results = await Promise.all(file.tiles.map((t) => fireTile(scenario, file, t, minds.reflex!)));
  for (const r of results) assert.ok(r.pass, `${r.tile.id}: ${r.error ?? `got ${r.choice} at ${r.confidence}`}`);
});
