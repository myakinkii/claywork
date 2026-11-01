// Play a world in real time. The wheel keeps turning whether you act or not.
// Usage: npm run play [-- worlds/some-world.json] ; env NAME=Anna TICK_MS=2500 ART=ansi|plain|off
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { loadScenario, type Scenario } from "@claywork/clay";
import { fire } from "@claywork/kiln";
import { Wheel } from "@claywork/wheel";
import { perspective } from "@claywork/slip";
import { clarify, glaze, help, toAnsi, toPlain, toText, understand, type MetaDoc } from "@claywork/glaze";
import { awaken, type Minds } from "@claywork/golems";

const path = resolve(process.argv[2] ?? "worlds/drowned-cellar.json");
const tickMs = Number(process.env.TICK_MS ?? 2500);
const scenario: Scenario = loadScenario(path);

const firing = fire(scenario);
if (!firing.ok) {
  for (const c of firing.cracks) console.error(`✗ [${c.code}] ${c.message}`);
  process.exit(1);
}

const wheel = new Wheel(scenario);
const me = "player";
wheel.join({ id: me, name: process.env.NAME ?? "Wanderer" });

// --- golems: the world's own minds file, if it has one (<world>.minds.ts) ---------
const mindsFile = path.replace(/\.json$/, ".minds.ts");
const minds: Minds = existsSync(mindsFile) ? ((await import(pathToFileURL(mindsFile).href)) as { default: () => Minds }).default() : {};
awaken(wheel, { ...minds, deadlineMs: Math.min(minds.deadlineMs ?? 800, tickMs / 2) });

// --- the terminal ---------------------------------------------------------------
const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
let choices: string[] = [];

const print = (text: string) => {
  process.stdout.write("\r\x1b[K" + text + "\n");
  rl.prompt(true);
};
const show = () => {
  if (!wheel.world.isAlive(me)) return;
  const rendered = toText(glaze(wheel.observe(me), wheel.options(me)));
  choices = rendered.choices;
  print("\n" + rendered.text);
};

wheel.slip.subscribe((event) => {
  const art = picture(event.art);
  if (art) print(`\n${art}`);
  if (event.name === "looked" || (event.actor === me && event.name === "entered" && event.tick === 0)) return print(perspective(event, me));
  print(`  ${event.actor === me ? "·" : "»"} ${perspective(event, me)}`);
  if (event.actor === me && event.name === "died") {
    print("\nYou died. The clay takes you back.");
    shutdown();
  }
  if (event.actor === me && event.name === "won") {
    print("\nThe adventure is complete, but the world goes on. Stay as long as you like; /quit to leave.");
  }
}, { actor: me });

wheel.onTurn((events) => {
  if (events.some((e) => e.actor === me && ["entered", "taken", "dropped", "opened", "unlocked", "searched"].includes(e.name)) || events.some((e) => e.name === "narration")) show();
});

// Pictures: truecolor half-blocks by default, the raw grid for terminals without color.
let artMode = (process.env.ART ?? (process.env.NO_COLOR ? "plain" : "ansi")).toLowerCase();
const picture = (id: string | undefined): string | null => {
  const sprite = id ? scenario.art?.[id] : undefined;
  if (!sprite || artMode === "off") return null;
  return artMode === "plain" ? toPlain(sprite) : toAnsi(sprite);
};

const meta: MetaDoc[] = [
  { usage: "/art on, /art off", summary: "Show or hide the pictures that come with some moments." },
  { usage: "/help, /?", summary: "This overview." },
  { usage: "/look", summary: "Describe where you are again (or just press Enter)." },
  { usage: "/quit", summary: "Leave the world." },
];

rl.on("line", (line) => {
  const cmd = understand(line, {
    actor: me,
    observation: wheel.observe(me),
    options: wheel.options(me),
    verbs: wheel.verbs(),
    choices,
  });
  switch (cmd.kind) {
    case "empty":
      return show();
    case "meta":
      if (cmd.name === "help" || cmd.name === "?") return print("\n" + help(wheel.verbs(), wheel.options(me), meta));
      if (cmd.name === "look") return show();
      if (cmd.name === "art") {
        const on = cmd.args.trim().toLowerCase();
        if (on === "off") artMode = "off";
        else if (on === "on") artMode = process.env.ART && process.env.ART !== "off" ? process.env.ART : "ansi";
        return print(`  (pictures ${artMode === "off" ? "off" : "on"})`);
      }
      if (cmd.name === "quit" || cmd.name === "q") return shutdown();
      return print(`  (unknown command /${cmd.name}, try /help)`);
    case "ambiguous":
      return print(`  ${clarify(cmd)}`);
    case "unknown":
      return print(`  ${cmd.message}`);
    case "act":
      wheel.submit(cmd.intent);
      if (cmd.intent.verb !== "say") print(`  … ${cmd.label}`);
  }
});

function shutdown() {
  wheel.stop();
  rl.close();
  process.exit(0);
}

console.log(`${scenario.title} — the wheel turns every ${tickMs}ms. Type a number or a command ("take shovel", "'hello"), /help for an overview, /quit to leave.`);
if (scenario.intro) console.log(`\n${scenario.intro}`);
show();
wheel.start(tickMs);
