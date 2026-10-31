import type { Id, Observation, Option, Seen } from "@claywork/clay";

/**
 * Glaze: the surface people see and touch.
 *
 * The same closed set of options a model chooses from becomes the links a human
 * clicks. Options are grouped by the thing they act on, so every thing in the
 * prose carries its own little menu of actions.
 */

export interface Link {
  option: string;
  label: string;
}

export interface Item {
  id: Id;
  name: string;
  state: string[];
  /** "in the iron chest" for things inside containers. */
  where?: string;
  links: Link[];
}

export interface View {
  title: string;
  description?: string;
  things: Item[];
  exits: Item[];
  carrying: Item[];
  /** Actions with no target: look around, wait. */
  general: Link[];
  recent: string[];
  status: string[];
}

export function glaze(obs: Observation, options: Option[]): View {
  const byTarget = new Map<Id, Link[]>();
  const general: Link[] = [];
  for (const o of options) {
    const link = { option: o.id, label: o.label };
    const target = o.intent.target;
    if (!target) general.push(link);
    else byTarget.set(target, [...(byTarget.get(target) ?? []), link]);
  }
  const names = new Map<Id, string>([...obs.visible, ...obs.self.carrying].map((s) => [s.id, s.name]));
  const item = (s: Seen): Item => ({
    id: s.id,
    name: s.name,
    state: s.state,
    ...(s.inside && names.has(s.inside) ? { where: `in the ${names.get(s.inside)}` } : {}),
    links: byTarget.get(s.id) ?? [],
  });
  return {
    title: obs.room.title,
    ...(obs.room.description ? { description: obs.room.description } : {}),
    things: obs.visible.map(item),
    exits: obs.exits.map((e) => ({ ...item(e), name: e.direction ?? e.name })),
    carrying: obs.self.carrying.map(item),
    general,
    recent: obs.recent,
    status: obs.self.state,
  };
}

// --- plain text, for terminals: links become numbers -------------------------

export function toText(view: View): { text: string; choices: string[] } {
  const choices: string[] = [];
  const num = (l: Link) => {
    choices.push(l.option);
    return `[${choices.length}] ${l.label}`;
  };
  const describe = (i: Item) => {
    const tags = [...i.state, ...(i.where ? [i.where] : [])];
    const head = `  ${i.name}${tags.length ? ` (${tags.join(", ")})` : ""}`;
    return i.links.length ? `${head}: ${i.links.map(num).join("  ")}` : head;
  };
  const lines = [`== ${view.title} ==`];
  if (view.description) lines.push(view.description);
  if (view.things.length) lines.push("", "You see:", ...view.things.map(describe));
  if (view.exits.length) lines.push("", "Exits:", ...view.exits.map(describe));
  if (view.carrying.length) lines.push("", "You carry:", ...view.carrying.map(describe));
  lines.push("", view.general.map(num).join("  "));
  if (view.status.length) lines.push(`(${view.status.join(", ")})`);
  return { text: lines.join("\n"), choices };
}

// --- HTML, for the browser: links carry the option id ------------------------

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function toHtml(view: View): string {
  const link = (l: Link) => `<a href="#" class="act" data-option="${escape(l.option)}">${escape(l.label)}</a>`;
  const item = (i: Item) => {
    const tags = [...i.state, ...(i.where ? [i.where] : [])];
    return `<li><span class="thing" data-thing="${escape(i.id)}">${escape(i.name)}</span>${
      tags.length ? ` <small>(${escape(tags.join(", "))})</small>` : ""
    }${i.links.length ? ` <span class="acts">${i.links.map(link).join(" · ")}</span>` : ""}</li>`;
  };
  const section = (title: string, items: Item[]) => (items.length ? `<h3>${title}</h3><ul>${items.map(item).join("")}</ul>` : "");
  return [
    `<article class="glaze">`,
    `<h2>${escape(view.title)}</h2>`,
    view.description ? `<p>${escape(view.description)}</p>` : "",
    section("You see", view.things),
    section("Exits", view.exits),
    section("You carry", view.carrying),
    `<nav>${view.general.map(link).join(" · ")}</nav>`,
    view.recent.length ? `<ol class="recent">${view.recent.map((r) => `<li>${escape(r)}</li>`).join("")}</ol>` : "",
    `</article>`,
  ].join("");
}
