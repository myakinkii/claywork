import { test } from "node:test";
import assert from "node:assert/strict";
import { loadScenario } from "@claywork/clay";
import { Wheel } from "@claywork/wheel";
import { glaze, toHtml, toText } from "@claywork/glaze";

const setup = () => {
  const wheel = new Wheel(loadScenario(new URL("../../../worlds/drowned-cellar.json", import.meta.url)));
  wheel.join({ id: "anna", name: "Anna" });
  wheel.submit({ actor: "anna", verb: "go", target: "stairs_down" });
  wheel.turn();
  return glaze(wheel.observe("anna"), wheel.options("anna"));
};

test("every thing carries its own actions as links", () => {
  const view = setup();
  const chest = view.things.find((t) => t.id === "iron_chest")!;
  assert.deepEqual(chest.links.map((l) => l.option), ["look:iron_chest", "open:iron_chest"]);
  assert.deepEqual(chest.state, ["closed"]);
  assert.deepEqual(view.exits.map((e) => e.name), ["up", "east"]);
  assert.deepEqual(view.general.map((l) => l.label), ["look around", "search", "listen", "wait"]);
});

test("text numbers every link, in order", () => {
  const { text, choices } = toText(setup());
  assert.match(text, /== Flooded Cellar ==/);
  assert.match(text, /\[\d+\] open iron chest/);
  assert.equal(new Set(choices).size, choices.length);
});

test("html links carry option ids and escape content", () => {
  const html = toHtml(setup());
  assert.match(html, /data-option="attack:goblin"/);
  assert.doesNotMatch(html, /<script/);
});
