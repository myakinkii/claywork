import type { Sprite } from "@claywork/clay";
import type { View } from "@claywork/glaze";

/** Everything a client may say. */
export type ClientMessage =
  | { type: "hello"; token?: string }
  | { type: "start"; world: string; name: string }
  | { type: "join"; instance: string; name: string }
  | { type: "command"; text: string }
  | { type: "option"; id: string }
  | { type: "leave" };

export interface WorldInfo {
  id: string;
  title: string;
  intro?: string;
}

export interface InstanceInfo {
  id: string;
  world: string;
  title: string;
  members: { name: string; present: boolean }[];
}

/** Everything the server may say. */
export type ServerMessage =
  | { type: "welcome"; token: string }
  | { type: "lobby"; worlds: WorldInfo[]; instances: InstanceInfo[] }
  /** You are in a world. Its art library comes once, here; events refer to sprites by id. */
  | { type: "joined"; instance: InstanceInfo; actor: string; art: Record<string, Sprite> }
  | { type: "view"; view: View; dead: boolean }
  /** Something perceived in the world, already from this player's perspective. */
  | { type: "event"; name: string; text: string; mine: boolean; tick: number; art?: string }
  /** The client talking, not the world: help, clarifications, errors in what was typed. */
  | { type: "notice"; text: string; kind: "help" | "info" | "error" }
  /** Who is in this world with you, sent whenever it changes. */
  | { type: "party"; members: { name: string; present: boolean; you: boolean }[] }
  | { type: "left" };
