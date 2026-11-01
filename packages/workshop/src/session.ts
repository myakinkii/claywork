import type { Id } from "@claywork/clay";
import { perspective } from "@claywork/slip";
import { glaze, help, understand, clarify, type MetaDoc } from "@claywork/glaze";
import type { Instance } from "./instance.ts";
import type { ServerMessage } from "./protocol.ts";

export type Send = (message: ServerMessage) => void;

export const META: MetaDoc[] = [
  { usage: "/help, /?", summary: "This overview." },
  { usage: "/look", summary: "Describe where you are again (or send an empty line)." },
  { usage: "/leave", summary: "Leave this world and return to the lobby." },
];

/**
 * A player's seat at the workshop. It outlives connections: when the socket drops,
 * the session (and the body in the world) stays, and a reconnect with the token
 * picks it up again.
 */
export class Session {
  readonly token: string;
  instance: Instance | undefined;
  actor: Id | undefined;
  #send: Send | undefined;
  #unsubscribe: (() => void) | undefined;
  #lastView = "";

  constructor(token: string) {
    this.token = token;
  }

  get connected(): boolean {
    return this.#send !== undefined;
  }

  send(message: ServerMessage): void {
    this.#send?.(message);
  }

  /** A connection arrives (first time or reconnect). */
  connect(send: Send): void {
    this.#send = send;
    this.#lastView = "";
    send({ type: "welcome", token: this.token });
    if (this.instance && this.actor) {
      const { wheel } = this.instance;
      wheel.world.revoke(this.actor, "linkdead");
      const room = wheel.world.roomOf(this.actor);
      if (room) wheel.announce({ name: "stirred", scope: { kind: "room", room }, actor: this.actor, text: `${wheel.world.get(this.actor).name} stirs and looks around.`, you: "You come back to yourself." });
      this.#greet();
    }
  }

  /** The connection is gone. The body stays where it is, link-dead. */
  disconnect(): void {
    this.#send = undefined;
    if (this.instance && this.actor && this.instance.wheel.world.has(this.actor)) {
      const { wheel } = this.instance;
      wheel.world.grant(this.actor, "linkdead");
      const room = wheel.world.roomOf(this.actor);
      if (room) wheel.announce({ name: "linkdead", scope: { kind: "room", room }, actor: this.actor, text: `${wheel.world.get(this.actor).name} goes still, staring at nothing.` });
    }
  }

  /** Enter an instance as a new character. */
  enter(instance: Instance, name: string): void {
    this.instance = instance;
    this.actor = instance.join(this, name);
    this.#unsubscribe = instance.wheel.slip.subscribe((event) => {
      if (!this.actor) return;
      this.send({ type: "event", name: event.name, text: perspective(event, this.actor), mine: event.actor === this.actor, tick: event.tick });
    }, { actor: this.actor });
    this.#greet();
  }

  /** Leave the instance and go back to the lobby. */
  exit(): Instance | undefined {
    const instance = this.instance;
    if (!instance || !this.actor) return undefined;
    this.#unsubscribe?.();
    instance.leave(this.actor);
    this.instance = undefined;
    this.actor = undefined;
    this.#lastView = "";
    this.send({ type: "left" });
    return instance;
  }

  /** Tell this player who shares the world with them. */
  party(): void {
    if (!this.instance) return;
    const members = [...this.instance.members].map(([actor, s]) => ({
      name: this.instance!.wheel.world.get(actor).name,
      present: s.connected,
      you: actor === this.actor,
    }));
    this.send({ type: "party", members });
  }

  /** Send the current view if it changed since the last one. Called after every turn. */
  refresh(force = false): void {
    if (!this.connected || !this.instance || !this.actor) return;
    const { wheel } = this.instance;
    if (!wheel.world.has(this.actor) || wheel.world.roomOf(this.actor) === null) return;
    const dead = !wheel.world.isAlive(this.actor);
    const view = glaze(wheel.observe(this.actor), wheel.options(this.actor));
    const key = JSON.stringify({ ...view, recent: [], dead });
    if (!force && key === this.#lastView) return;
    this.#lastView = key;
    this.send({ type: "view", view, dead });
  }

  /** Typed text or a clicked option. Meta commands that need the workshop are returned to it. */
  command(input: { text?: string; option?: string }): "leave" | undefined {
    if (!this.instance || !this.actor) {
      this.send({ type: "notice", kind: "error", text: "You are not in a world. Start or join one first." });
      return undefined;
    }
    const { wheel } = this.instance;
    const actor = this.actor;
    if (input.option !== undefined) {
      const option = wheel.options(actor).find((o) => o.id === input.option);
      if (!option) this.send({ type: "notice", kind: "error", text: "That is no longer possible." });
      else wheel.submit(option.intent);
      return undefined;
    }
    const cmd = understand(input.text ?? "", { actor, observation: wheel.observe(actor), options: wheel.options(actor), verbs: wheel.verbs() });
    switch (cmd.kind) {
      case "empty":
        this.refresh(true);
        return undefined;
      case "meta":
        if (cmd.name === "help" || cmd.name === "?") this.send({ type: "notice", kind: "help", text: help(wheel.verbs(), wheel.options(actor), META) });
        else if (cmd.name === "look") this.refresh(true);
        else if (cmd.name === "leave" || cmd.name === "quit") return "leave";
        else this.send({ type: "notice", kind: "error", text: `There is no /${cmd.name}. Type /help to see what you can do.` });
        return undefined;
      case "ambiguous":
        this.send({ type: "notice", kind: "info", text: clarify(cmd) });
        return undefined;
      case "unknown":
        this.send({ type: "notice", kind: "error", text: cmd.message });
        return undefined;
      case "act":
        wheel.submit(cmd.intent);
        return undefined;
    }
  }

  #greet(): void {
    if (!this.instance || !this.actor) return;
    const { wheel } = this.instance;
    this.send({ type: "joined", instance: this.instance.info(), actor: this.actor });
    // The intro and anything else remembered: Slip has been tracking this actor since it joined.
    for (const event of wheel.slip.recent(this.actor, 10)) {
      this.send({ type: "event", name: event.name, text: perspective(event, this.actor), mine: event.actor === this.actor, tick: event.tick });
    }
    this.refresh(true);
  }
}
