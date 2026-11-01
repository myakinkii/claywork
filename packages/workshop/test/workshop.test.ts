import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Workshop, loadWorlds, type ServerMessage } from "@claywork/workshop";

const worldsDir = fileURLToPath(new URL("../../../worlds/", import.meta.url));

async function workshop() {
  const { shelf, rejected } = await loadWorlds(worldsDir);
  assert.deepEqual(rejected, []);
  let n = 0;
  return new Workshop(shelf, { tickMs: 0, token: () => `t${++n}` });
}

/** A fake connection that remembers everything it was sent. */
function client(ws: Workshop, token?: string) {
  const inbox: ServerMessage[] = [];
  const session = ws.connect((m) => inbox.push(m), token);
  const last = <T extends ServerMessage["type"]>(type: T) => inbox.filter((m) => m.type === type).at(-1) as Extract<ServerMessage, { type: T }> | undefined;
  const events = () => inbox.flatMap((m) => (m.type === "event" ? [m.text] : []));
  const say = (text: string) => ws.receive(session, { type: "command", text });
  return { inbox, session, last, events, say };
}

test("the shelf holds fired worlds, with their minds", async () => {
  const ws = await workshop();
  assert.deepEqual(ws.shelf.map((w) => w.id), ["drowned-cellar"]);
  assert.equal(typeof ws.shelf[0]!.minds, "function");
});

test("a new connection gets a token and the lobby", async () => {
  const ws = await workshop();
  const anna = client(ws);
  assert.deepEqual(anna.inbox[0], { type: "welcome", token: "t1" });
  const lobby = anna.last("lobby")!;
  assert.equal(lobby.worlds[0]!.title, "The Drowned Cellar");
  assert.deepEqual(lobby.instances, []);
  ws.close();
});

test("start a world, see the intro and the first view, and act", async () => {
  const ws = await workshop();
  const anna = client(ws);
  ws.receive(anna.session, { type: "start", world: "drowned-cellar", name: "anna" });
  const joined = anna.last("joined")!;
  assert.deepEqual(joined.instance.members, [{ name: "Anna", present: true }]);
  assert.match(anna.events()[0]!, /door of the old potter's house/);
  assert.equal(anna.last("view")!.view.title, "Stairwell");

  anna.say("search");
  ws.instances.get(joined.instance.id)!.wheel.turn();
  assert.match(anna.events().at(-1)!, /find: old shovel, crooked brick/);
  assert.ok(anna.last("view")!.view.things.some((t) => t.id === "old_shovel"), "the view refreshed after the turn");

  ws.receive(anna.session, { type: "option", id: "take:old_shovel" });
  ws.instances.get(joined.instance.id)!.wheel.turn();
  assert.equal(anna.events().at(-1), "You take the old shovel.");
  ws.close();
});

test("a second player joins the party and they perceive each other", async () => {
  const ws = await workshop();
  const anna = client(ws);
  ws.receive(anna.session, { type: "start", world: "drowned-cellar", name: "Anna" });
  const bob = client(ws);
  const id = bob.last("lobby")!.instances[0]!.id;
  ws.receive(bob.session, { type: "join", instance: id, name: "Bob" });
  assert.equal(anna.events().at(-1), "Bob appears.");
  bob.say("'Anyone here?");
  ws.instances.get(id)!.wheel.turn();
  assert.equal(anna.events().at(-1), 'Bob says: "Anyone here?"');
  ws.close();
});

test("disconnecting leaves the body link-dead; reconnecting picks it up", async () => {
  const ws = await workshop();
  const anna = client(ws);
  ws.receive(anna.session, { type: "start", world: "drowned-cellar", name: "Anna" });
  const bob = client(ws);
  const id = bob.last("lobby")!.instances[0]!.id;
  ws.receive(bob.session, { type: "join", instance: id, name: "Bob" });

  ws.disconnect(anna.session);
  assert.equal(bob.events().at(-1), "Anna goes still, staring at nothing.");
  const wheel = ws.instances.get(id)!.wheel;
  bob.say("search"); // the stairwell is dark: Bob has to feel around to find her
  wheel.turn();
  assert.match(bob.events().at(-1)!, /find: old shovel, crooked brick, Anna/);
  const annaSeen = bob.last("view")!.view.things.find((t) => t.name === "Anna");
  assert.deepEqual(annaSeen?.state, ["hp 20/20", "motionless"]);
  assert.deepEqual(ws.instances.get(id)!.info().members, [{ name: "Anna", present: false }, { name: "Bob", present: true }]);

  const again = client(ws, "t1");
  assert.equal(again.session, anna.session);
  assert.equal(again.last("joined")!.actor, anna.session.actor);
  assert.equal(bob.events().at(-1), "Anna stirs and looks around.");
  assert.ok(!wheel.world.hasTrait(anna.session.actor!, "linkdead"));
  ws.close();
});

test("help and leaving are talked about outside the world", async () => {
  const ws = await workshop();
  const anna = client(ws);
  ws.receive(anna.session, { type: "start", world: "drowned-cellar", name: "Anna" });
  anna.say("/help");
  assert.match(anna.last("notice")!.text, /\/leave\s+Leave this world/);
  anna.say("dance");
  assert.equal(anna.last("notice")!.kind, "error");

  const id = anna.session.instance!.id;
  anna.say("/leave");
  assert.equal(anna.last("left")!.type, "left");
  assert.ok(!ws.instances.has(id), "the last one out stops the world");
  assert.deepEqual(anna.last("lobby")!.instances, []);
  ws.close();
});

test("names are cleaned, and bad requests explain themselves", async () => {
  const ws = await workshop();
  const anna = client(ws);
  ws.receive(anna.session, { type: "start", world: "nowhere", name: "Anna" });
  assert.match(anna.last("notice")!.text, /no world called "nowhere"/);
  ws.receive(anna.session, { type: "start", world: "drowned-cellar", name: "<script>" });
  assert.equal(anna.last("joined")!.instance.members[0]!.name, "Script");
  ws.receive(anna.session, { type: "start", world: "drowned-cellar", name: "Anna" });
  assert.match(anna.last("notice")!.text, /Leave your current world first/);
  ws.close();
});

test("the party hears about who comes, goes and goes away", async () => {
  const ws = await workshop();
  const anna = client(ws);
  ws.receive(anna.session, { type: "start", world: "drowned-cellar", name: "Anna" });
  assert.deepEqual(anna.last("party")!.members, [{ name: "Anna", present: true, you: true }]);
  const bob = client(ws);
  ws.receive(bob.session, { type: "join", instance: anna.session.instance!.id, name: "Bob" });
  assert.deepEqual(anna.last("party")!.members.map((m) => m.name), ["Anna", "Bob"]);
  ws.disconnect(bob.session);
  assert.deepEqual(anna.last("party")!.members[1], { name: "Bob", present: false, you: false });
  ws.close();
});
