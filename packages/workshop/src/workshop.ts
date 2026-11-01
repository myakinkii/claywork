import { randomBytes } from "node:crypto";
import { Instance } from "./instance.ts";
import { Session, type Send } from "./session.ts";
import type { ClientMessage, ServerMessage, WorldInfo } from "./protocol.ts";
import type { ShelvedWorld } from "./worlds.ts";
import { silent, type Debug } from "./debug.ts";

export interface WorkshopOptions {
  /** Milliseconds per tick for new instances. 0 = tests turn wheels by hand. */
  tickMs?: number;
  /** Token generator, injectable for tests. */
  token?: () => string;
  debug?: Debug;
}

/**
 * The workshop: shelves of fired worlds, the instances currently turning, and every
 * player's session. Transport-agnostic: a server feeds it messages and gives it a
 * send function per connection.
 */
export class Workshop {
  readonly shelf: ShelvedWorld[];
  readonly instances = new Map<string, Instance>();
  readonly sessions = new Map<string, Session>();
  readonly #tickMs: number;
  readonly #token: () => string;
  readonly #debug: Debug;
  #next = 1;

  constructor(shelf: ShelvedWorld[], options: WorkshopOptions = {}) {
    this.shelf = shelf;
    this.#tickMs = options.tickMs ?? 2000;
    this.#token = options.token ?? (() => randomBytes(12).toString("base64url"));
    this.#debug = options.debug ?? silent;
  }

  /** A connection arrives, maybe carrying the token of an existing session. */
  connect(send: Send, token?: string): Session {
    let session = token ? this.sessions.get(token) : undefined;
    if (!session) {
      session = new Session(this.#token());
      this.sessions.set(session.token, session);
      this.#debug.log("net", `new session ${short(session.token)}${token ? ` (unknown token ${short(token)})` : ""}`);
    } else {
      this.#debug.log("net", `session ${short(session.token)} reconnected${session.actor ? ` as ${session.actor}` : ""}`);
    }
    session.connect(send);
    if (!session.instance) session.send(this.lobby());
    this.#changed(session.instance);
    return session;
  }

  disconnect(session: Session): void {
    this.#debug.log("net", `session ${short(session.token)} disconnected${session.actor ? `, ${session.actor} is link-dead` : ""}`);
    session.disconnect();
    // A session that is in no world has nothing to keep alive.
    if (!session.instance) this.sessions.delete(session.token);
    this.#changed(session.instance);
  }

  receive(session: Session, message: ClientMessage): void {
    switch (message.type) {
      case "hello":
        return;
      case "start": {
        const world = this.shelf.find((w) => w.id === message.world);
        if (!world) return session.send(error(`There is no world called "${message.world}".`));
        if (session.instance) return session.send(error("Leave your current world first."));
        const name = cleanName(message.name);
        if (!name) return session.send(error("Choose a name of 1 to 24 letters first."));
        const instance = new Instance(`i${this.#next++}`, world, { tickMs: this.#tickMs, debug: this.#debug });
        this.instances.set(instance.id, instance);
        session.enter(instance, name);
        this.#debug.log("net", `${name} (${short(session.token)}) started ${world.id} as ${instance.id}, playing ${session.actor}`);
        return this.#changed(instance);
      }
      case "join": {
        const instance = this.instances.get(message.instance);
        if (!instance) return session.send(error("That world has stopped turning."));
        if (session.instance) return session.send(error("Leave your current world first."));
        const name = cleanName(message.name);
        if (!name) return session.send(error("Choose a name of 1 to 24 letters first."));
        session.enter(instance, name);
        this.#debug.log("net", `${name} (${short(session.token)}) joined ${instance.id} as ${session.actor}`);
        return this.#changed(instance);
      }
      case "command":
        if (session.command({ text: message.text }) === "leave") this.#leave(session);
        return;
      case "option":
        session.command({ option: message.id });
        return;
      case "leave":
        return this.#leave(session);
    }
  }

  lobby(): ServerMessage {
    return { type: "lobby", worlds: this.shelf.map(worldInfo), instances: [...this.instances.values()].map((i) => i.info()) };
  }

  /** Stop every instance, for shutdown. */
  close(): void {
    for (const instance of this.instances.values()) instance.stop();
    this.instances.clear();
  }

  #leave(session: Session): void {
    const actor = session.actor;
    const instance = session.exit();
    if (instance) this.#debug.log("net", `${actor} left ${instance.id}`);
    if (instance?.empty) {
      instance.stop();
      this.instances.delete(instance.id);
      this.#debug.log("net", `${instance.id} is empty and stopped`);
    }
    session.send(this.lobby());
    this.#changed(instance?.empty ? undefined : instance);
  }

  /** Membership or presence changed: tell the party, and everyone in the lobby. */
  #changed(instance: Instance | undefined): void {
    if (instance) for (const s of instance.members.values()) s.party();
    this.#broadcastLobby();
  }

  #broadcastLobby(): void {
    const lobby = this.lobby();
    for (const s of this.sessions.values()) if (!s.instance) s.send(lobby);
  }
}

/** Tokens are secrets: logs only show their first characters. */
function short(token: string): string {
  return `${token.slice(0, 4)}…`;
}

function worldInfo(w: ShelvedWorld): WorldInfo {
  return { id: w.id, title: w.scenario.title, ...(w.scenario.intro ? { intro: w.scenario.intro } : {}) };
}

function error(text: string): ServerMessage {
  return { type: "notice", kind: "error", text };
}

function cleanName(raw: string): string | null {
  const name = raw.replace(/[^\p{L}\p{N} '-]/gu, "").trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 24 ? name.charAt(0).toUpperCase() + name.slice(1) : null;
}
