import type { Id, Thing, VerbConfig } from "@claywork/clay";
import { the, touchable, type Verb } from "./verbs.ts";

/**
 * A verb defined by the world, as data. It has no built-in effect: it generates
 * options for the things it applies to, announces itself, and leaves the meaning
 * to glyph triggers ("on": "pray"). If no trigger answers, nothing happens.
 */
export function worldVerb(name: string, config: VerbConfig): Verb {
  const phrase = config.phrase ?? name;
  const targeted = config.appliesTo !== undefined;
  const applies = (t: Thing) =>
    (config.appliesTo?.ids?.includes(t.id) ?? false) || (config.appliesTo?.trait !== undefined && t.traits[config.appliesTo.trait] !== undefined);

  const verb: Verb = {
    name,
    origin: "world",
    summary: config.summary ?? `${cap(name)}.`,
    usage: config.usage ?? (targeted ? `${phrase} <thing>` : phrase),
    ...(config.aliases ? { aliases: config.aliases } : {}),
    options(world, actor) {
      const hint = config.summary ?? `${cap(name)}.`;
      if (!targeted) return [{ id: name, intent: { actor, verb: name }, label: phrase, hint }];
      return touchable(world, actor)
        .filter(applies)
        .map((t) => ({ id: `${name}:${t.id}`, intent: { actor, verb: name, target: t.id }, label: `${phrase} ${t.name}`, hint: `${hint} (${the(t)})` }));
    },
    check({ world, actor, intent }) {
      if (!targeted) return null;
      const target = intent.target && world.has(intent.target) ? world.get(intent.target) : null;
      if (!target || !touchable(world, actor).some((t) => t.id === target.id)) return "You don't see that here.";
      if (!applies(target)) return `You can't ${phrase} that.`;
      return null;
    },
    perform({ world, actor, intent }) {
      // nothing: "" means the verb is quiet when no trigger answers (a golem's reaction may follow)
      const silent = config.nothing === "" ? {} : { silent: config.nothing ?? "Nothing happens." };
      if (!config.text && !config.you) return { events: [], ...silent };
      const room = world.roomOf(actor);
      const fill = (template: string) => template.replace(/\{(actor|Actor|target|Target)\}/g, (_m, key: string) => {
        const id: Id | undefined = key.toLowerCase() === "actor" ? actor : intent.target;
        const words = id && world.has(id) ? the(world.get(id)) : "";
        return key[0] === key[0]!.toUpperCase() ? cap(words) : words;
      });
      const you = fill(config.you ?? config.text!);
      return {
        events: [{
          name,
          scope: room ? { kind: "room", room } : { kind: "actor", actor },
          actor,
          ...(intent.target ? { target: intent.target } : {}),
          text: config.text ? fill(config.text) : you,
          you,
          // kept so minds can re-render it from their own point of view
          ...(config.text ? { data: { template: config.text } } : {}),
        }],
        ...silent,
      };
    },
  };
  return verb;
}

/** A standard verb with the world's description and aliases laid over it. */
export function redescribe(verb: Verb, config: VerbConfig): Verb {
  return {
    ...verb,
    ...(config.summary ? { summary: config.summary } : {}),
    ...(config.usage ? { usage: config.usage } : {}),
    ...(config.aliases ? { aliases: [...(verb.aliases ?? []), ...config.aliases] } : {}),
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
