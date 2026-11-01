import type { Id, Intent, Observation, Option } from "@claywork/clay";

/**
 * The other half of the surface: what people type.
 *
 * Three layers, kept apart on purpose:
 *  - meta commands ("/help", "/quit") talk to the client, never to the world;
 *  - verbs are the world-independent vocabulary ("take", "look", "say");
 *  - options are the world-specific moves that are legal right now ("take old shovel").
 *
 * Typed text is matched against the legal options first. If nothing legal matches
 * but the words name a verb and something the actor can perceive, we still build the
 * intent and let the wheel explain why it fails: intents, not mutations.
 */

export interface VerbDoc {
  name: string;
  summary: string;
  usage: string;
  aliases?: string[];
  freeText?: boolean;
  /** "engine" verbs exist in every world; "world" verbs only in this one. */
  origin?: "engine" | "world";
}

export interface MetaDoc {
  usage: string;
  summary: string;
}

export type Command =
  | { kind: "empty" }
  | { kind: "meta"; name: string; args: string }
  /** "option": a legal option matched. "guess": built from perception; the wheel may refuse it. */
  | { kind: "act"; intent: Intent; label: string; matched: "option" | "guess" }
  | { kind: "ambiguous"; verb: string; candidates: Option[] }
  | { kind: "unknown"; message: string };

export interface CommandContext {
  actor: Id;
  observation: Observation;
  options: Option[];
  verbs: VerbDoc[];
  /** Option ids in the order they were numbered on screen, so "3" works. */
  choices?: string[];
}

const FILLER = new Set(["the", "a", "an", "at", "to", "with", "on", "in", "into", "through", "my"]);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w && !FILLER.has(w));
const contains = (haystack: string[], needles: string[]) => needles.every((n) => haystack.includes(n));

export function understand(input: string, ctx: CommandContext): Command {
  const text = input.trim();
  if (!text) return { kind: "empty" };

  if (text.startsWith("/")) {
    const [head = "", ...rest] = text.slice(1).split(/\s+/);
    return { kind: "meta", name: head.toLowerCase() || "help", args: rest.join(" ") };
  }
  if (text === "?") return { kind: "meta", name: "help", args: "" };

  const act = (o: Option): Command => ({ kind: "act", intent: o.intent, label: o.label, matched: "option" });

  if (/^\d+$/.test(text) && ctx.choices) {
    const option = ctx.options.find((o) => o.id === ctx.choices![Number(text) - 1]);
    return option ? act(option) : { kind: "unknown", message: `There is no option ${text}.` };
  }

  const exact = ctx.options.find((o) => o.label.toLowerCase() === text.toLowerCase());
  if (exact) return act(exact);

  // "'hello" is shorthand for say
  const quoted = /^['"](.*?)['"]?$/.exec(text);
  const sayVerb = ctx.verbs.find((v) => v.freeText);
  if (quoted && sayVerb) return { kind: "act", intent: { actor: ctx.actor, verb: sayVerb.name, text: quoted[1]! }, label: `${sayVerb.name} ${quoted[1]}`, matched: "option" };

  const [first = "", ...restWords] = text.split(/\s+/);
  const verb = ctx.verbs.find((v) => v.name === first.toLowerCase() || v.aliases?.includes(first.toLowerCase()));

  if (!verb) {
    // A bare direction or exit name: "down", "east"
    const go = ctx.options.filter((o) => o.intent.verb === "go" && contains(words(o.label).slice(1), words(text)));
    if (go.length === 1) return act(go[0]!);
    const exit = findExit(ctx.observation, words(text));
    if (exit) return guess(ctx.actor, "go", exit.id, `go ${text}`);
    return { kind: "unknown", message: `I don't know how to "${first}". Type /help to see what you can do.` };
  }

  if (verb.freeText) {
    const said = text.slice(first.length).trim();
    return { kind: "act", intent: { actor: ctx.actor, verb: verb.name, text: said }, label: `${verb.name} ${said}`, matched: "option" };
  }

  const wanted = words(restWords.join(" "));
  const ofVerb = ctx.options.filter((o) => o.intent.verb === verb.name);

  if (wanted.length === 0) {
    const untargeted = ofVerb.find((o) => !o.intent.target);
    if (untargeted) return act(untargeted);
    if (ofVerb.length === 1) return act(ofVerb[0]!);
    if (ofVerb.length > 1) return { kind: "ambiguous", verb: verb.name, candidates: ofVerb };
    return { kind: "unknown", message: `There is nothing to ${verb.name} right now.` };
  }

  const matches = ofVerb.filter((o) => contains(words(o.label).slice(1), wanted));
  if (matches.length === 1) return act(matches[0]!);
  if (matches.length > 1) return { kind: "ambiguous", verb: verb.name, candidates: matches };

  // Nothing legal matches. If they named something they can perceive, let the wheel say why not.
  const thing = findThing(ctx.observation, wanted) ?? findExit(ctx.observation, wanted);
  if (thing) return guess(ctx.actor, verb.name, thing.id, `${verb.name} ${restWords.join(" ")}`);
  return { kind: "unknown", message: `You don't see "${restWords.join(" ")}" here.` };
}

function guess(actor: Id, verb: string, target: Id, label: string): Command {
  return { kind: "act", intent: { actor, verb, target }, label, matched: "guess" };
}

function findThing(obs: Observation, wanted: string[]) {
  const all = [...obs.visible, ...obs.self.carrying];
  const hits = all.filter((t) => contains(words(t.name), wanted));
  return hits.length === 1 ? hits[0] : undefined;
}

function findExit(obs: Observation, wanted: string[]) {
  const hits = obs.exits.filter((e) => contains(words(`${e.direction ?? ""} ${e.name}`), wanted));
  return hits.length === 1 ? hits[0] : undefined;
}

/** "Take what? old shovel, rusty key" */
export function clarify(cmd: Extract<Command, { kind: "ambiguous" }>): string {
  return `${cmd.verb.charAt(0).toUpperCase() + cmd.verb.slice(1)} what? ${cmd.candidates.map((c) => rest(c.label)).join(", ")}.`;
}

const rest = (label: string) => label.split(" ").slice(1).join(" ").replace(/^at /, "");

/**
 * The overview: client commands, the verb vocabulary, and what is possible right now.
 * Built only from legal options, so it never reveals a secret before the world does.
 */
export function help(verbs: VerbDoc[], options: Option[], meta: MetaDoc[] = []): string {
  const pad = (rows: [string, string][]) => {
    const width = Math.max(...rows.map(([a]) => a.length));
    return rows.map(([a, b]) => `  ${a.padEnd(width)}   ${b}`);
  };
  const lines: string[] = [];
  if (meta.length) lines.push("Talking to the game (outside the world):", ...pad(meta.map((m) => [m.usage, m.summary])), "");
  const describe = (v: VerbDoc): [string, string] => [v.usage, `${v.summary}${v.aliases?.length ? ` (also: ${v.aliases.join(", ")})` : ""}`];
  const engine = verbs.filter((v) => v.origin !== "world");
  const local = verbs.filter((v) => v.origin === "world");
  lines.push("Verbs:", ...pad(engine.map(describe)), "");
  if (local.length) lines.push("Verbs of this world:", ...pad(local.map(describe)), "");
  lines.push("Right now you can:");
  const byVerb = new Map<string, string[]>();
  for (const o of options) byVerb.set(o.intent.verb, [...(byVerb.get(o.intent.verb) ?? []), rest(o.label)]);
  for (const [verb, targets] of byVerb) {
    const shown = targets.filter(Boolean);
    lines.push(`  ${verb}${shown.length ? `: ${shown.join(", ")}` : ""}`);
  }
  return lines.join("\n");
}
