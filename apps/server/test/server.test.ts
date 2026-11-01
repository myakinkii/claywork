import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { Workshop, loadWorlds, type ServerMessage } from "@claywork/workshop";
import { parseMessage, serve } from "../src/server.ts";

const worlds = fileURLToPath(new URL("../../../worlds/", import.meta.url));

async function boot() {
  const { shelf } = await loadWorlds(worlds);
  const workshop = new Workshop(shelf, { tickMs: 30 });
  const server = serve(workshop, { port: 0 });
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  return { workshop, server, port };
}

/** A real websocket client that collects messages and can wait for one. */
async function player(port: number, token?: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox: ServerMessage[] = [];
  const waiters: [(m: ServerMessage) => boolean, (m: ServerMessage) => void][] = [];
  socket.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as ServerMessage;
    inbox.push(m);
    for (const [i, [match, resolve]] of [...waiters.entries()].reverse()) if (match(m)) (waiters.splice(i, 1), resolve(m));
  };
  await new Promise((r) => (socket.onopen = r));
  const send = (m: object) => socket.send(JSON.stringify(m));
  const until = (match: (m: ServerMessage) => boolean, ms = 3000) =>
    new Promise<ServerMessage>((resolve, reject) => {
      const found = inbox.find(match);
      if (found) return resolve(found);
      waiters.push([match, resolve]);
      setTimeout(() => reject(new Error(`timed out; got ${JSON.stringify(inbox.map((x) => x.type))}`)), ms);
    });
  send({ type: "hello", ...(token ? { token } : {}) });
  return { socket, inbox, send, until };
}

test("play over a real websocket: start, search, take, leave", async () => {
  const { workshop, server, port } = await boot();
  try {
    const anna = await player(port);
    await anna.until((m) => m.type === "lobby");
    anna.send({ type: "start", world: "drowned-cellar", name: "Anna" });
    await anna.until((m) => m.type === "view" && m.view.title === "Stairwell" && m.view.dark);
    anna.send({ type: "command", text: "search" });
    await anna.until((m) => m.type === "event" && /find: old shovel/.test(m.text));
    anna.send({ type: "option", id: "take:old_shovel" });
    await anna.until((m) => m.type === "view" && m.view.carrying.some((c) => c.id === "old_shovel"));
    anna.send({ type: "leave" });
    await anna.until((m) => m.type === "left");
    anna.socket.close();
  } finally {
    workshop.close();
    server.close();
  }
});

test("a dropped connection leaves a link-dead body that a reconnect picks up", async () => {
  const { workshop, server, port } = await boot();
  try {
    const anna = await player(port);
    const welcome = (await anna.until((m) => m.type === "welcome")) as Extract<ServerMessage, { type: "welcome" }>;
    anna.send({ type: "start", world: "drowned-cellar", name: "Anna" });
    await anna.until((m) => m.type === "joined");
    anna.socket.close();
    await new Promise((r) => setTimeout(r, 100));
    const [instance] = workshop.instances.values();
    assert.ok(instance, "the world keeps turning without her");
    const actor = [...instance.members.keys()][0]!;
    assert.ok(instance.wheel.world.hasTrait(actor, "linkdead"));

    const back = await player(port, welcome.token);
    const joined = await back.until((m) => m.type === "joined");
    assert.equal(joined.type === "joined" && joined.actor, actor);
    assert.ok(!instance.wheel.world.hasTrait(actor, "linkdead"));
    back.socket.close();
  } finally {
    workshop.close();
    server.close();
  }
});

test("malformed messages are ignored", () => {
  assert.equal(parseMessage("not json"), null);
  assert.equal(parseMessage(JSON.stringify({ type: "start", world: 3 })), null);
  assert.equal(parseMessage(JSON.stringify({ type: "command", text: "x".repeat(501) })), null);
  assert.deepEqual(parseMessage(JSON.stringify({ type: "leave" })), { type: "leave" });
});

test("health tells you the server is really yours", async () => {
  const { workshop, server, port } = await boot();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.deepEqual(await res.json(), { ok: true, worlds: 1, instances: 0, sessions: 0 });
  } finally {
    workshop.close();
    server.close();
  }
});
