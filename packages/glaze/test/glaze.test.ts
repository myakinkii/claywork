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

test("art renders as svg runs, ansi half-blocks, or the plain grid", async () => {
  const { runs, toSvg, toAnsi, toPlain } = await import("@claywork/glaze");
  const sprite = { palette: { A: "#ff0000", B: "#0000ff" }, rows: ["AAB.", "A..B"] };
  assert.deepEqual(runs(sprite), [
    { x: 0, y: 0, width: 2, fill: "#ff0000" },
    { x: 2, y: 0, width: 1, fill: "#0000ff" },
    { x: 0, y: 1, width: 1, fill: "#ff0000" },
    { x: 3, y: 1, width: 1, fill: "#0000ff" },
  ]);
  assert.match(toSvg(sprite, { scale: 3 }), /viewBox="0 0 4 2" width="12" height="6"/);
  const ansi = toAnsi(sprite);
  assert.equal(ansi.split("\n").length, 1, "two pixel rows per line");
  assert.match(ansi, /38;2;255;0;0m\x1b\[48;2;255;0;0m▀/, "red over red");
  assert.equal(toPlain(sprite), "AAB\nA  B");
});
