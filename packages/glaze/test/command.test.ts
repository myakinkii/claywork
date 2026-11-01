import { test } from "node:test";
import assert from "node:assert/strict";
import { loadScenario } from "@claywork/clay";
import { Wheel } from "@claywork/wheel";
import { help, understand, clarify, type Command } from "@claywork/glaze";

const setup = (where: "stairwell" | "cellar" = "cellar") => {
  const wheel = new Wheel(loadScenario(new URL("../../../worlds/drowned-cellar.json", import.meta.url)));
  wheel.join({ id: "anna", name: "Anna" });
  wheel.submit({ actor: "anna", verb: "search" });
  wheel.turn();
  if (where === "cellar") {
    wheel.submit({ actor: "anna", verb: "go", target: "stairs_down" });
    wheel.turn();
  }
  const parse = (input: string, choices?: string[]): Command =>
    understand(input, { actor: "anna", observation: wheel.observe("anna"), options: wheel.options("anna"), verbs: wheel.verbs(), ...(choices ? { choices } : {}) });
  return { wheel, parse };
};

const intentOf = (c: Command) => (c.kind === "act" ? c.intent : c);

test("slash commands talk to the client, not the world", () => {
  const { parse } = setup();
  assert.deepEqual(parse("/help"), { kind: "meta", name: "help", args: "" });
  assert.deepEqual(parse("?"), { kind: "meta", name: "help", args: "" });
  assert.deepEqual(parse("/say hi"), { kind: "meta", name: "say", args: "hi" });
});

test("typed commands match legal options by partial names and aliases", () => {
  const { parse } = setup("stairwell");
  assert.deepEqual(intentOf(parse("take shovel")), { actor: "anna", verb: "take", target: "old_shovel" });
  assert.deepEqual(intentOf(parse("get the shovel")), { actor: "anna", verb: "take", target: "old_shovel" });
  assert.deepEqual(intentOf(parse("x shovel")), { actor: "anna", verb: "look", target: "old_shovel" });
  assert.deepEqual(intentOf(parse("l")), { actor: "anna", verb: "look" });
  assert.deepEqual(intentOf(parse("down")), { actor: "anna", verb: "go", target: "stairs_down" });
  assert.deepEqual(intentOf(parse("1", ["look:old_shovel"])), { actor: "anna", verb: "look", target: "old_shovel" });
});

test("say keeps the words as typed, with a quote shorthand", () => {
  const { parse } = setup();
  assert.deepEqual(intentOf(parse("say Let me THROUGH")), { actor: "anna", verb: "say", text: "Let me THROUGH" });
  assert.deepEqual(intentOf(parse("'Shiny things?'")), { actor: "anna", verb: "say", text: "Shiny things?" });
});

test("impossible but perceivable: the wheel gets to explain", () => {
  const { wheel, parse } = setup();
  const cmd = parse("go east");
  assert.equal(cmd.kind === "act" && cmd.matched, "guess");
  wheel.submit((cmd as Extract<Command, { kind: "act" }>).intent);
  const [event] = wheel.turn().filter((e) => e.actor === "anna");
  assert.equal(event!.name, "failed");
  assert.match(event!.text, /iron door is closed/);
});

test("ambiguity asks, nonsense explains", () => {
  const { parse } = setup();
  const look = parse("look stone");
  assert.equal(look.kind, "act", "only one 'stone' thing here");
  const open = parse("open");
  assert.equal(open.kind, "act", "only one thing can be opened");
  const attack = parse("dance wildly");
  assert.equal(attack.kind, "unknown");
  const take = parse("take moon");
  assert.match((take as { message: string }).message, /don't see "moon"/);
});

test("clarify lists the candidates", () => {
  assert.equal(
    clarify({ kind: "ambiguous", verb: "take", candidates: [{ id: "a", label: "take rusty key", hint: "", intent: { actor: "x", verb: "take" } }, { id: "b", label: "take old key", hint: "", intent: { actor: "x", verb: "take" } }] }),
    "Take what? rusty key, old key.",
  );
});

test("help shows meta, the verb vocabulary and what is possible now, without secrets", () => {
  const { wheel } = setup();
  const text = help(wheel.verbs(), wheel.options("anna"), [{ usage: "/quit", summary: "Leave." }]);
  assert.match(text, /\/quit\s+Leave\./);
  assert.match(text, /take <thing>\s+Pick something up and carry it\. \(also: get, grab\)/);
  assert.match(text, /open: iron chest/);
  assert.match(text, /attack: goblin/);
  assert.doesNotMatch(text, /gap|niche/i, "the secret passage is not revealed yet");
});

test("help separates the engine's verbs from the world's own", () => {
  const { wheel } = setup();
  const text = help(wheel.verbs(), wheel.options("anna"));
  const [engine, world] = text.split("Verbs of this world:");
  assert.match(engine!, /take <thing>/);
  assert.doesNotMatch(engine!, /pray/);
  assert.match(world!, /pray at <thing>\s+Kneel and pray\. Some places listen\. \(also: kneel\)/);
});
