// Play a world in real time. The wheel keeps turning whether you act or not.
// Usage: npm run play [-- worlds/some-world.json] ; env NAME=Anna TICK_MS=2500
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { loadScenario, type Scenario } from "@claywork/clay";
import { fire } from "@claywork/kiln";
import { Wheel } from "@claywork/wheel";
import { perspective } from "@claywork/slip";
import { clarify, glaze, help, toText, understand, type MetaDoc } from "@claywork/glaze";
import { FakeReflex, type FakeRule } from "@claywork/reflex";
import { FakeReason } from "@claywork/reason";
import { animate, brute, reflexPolicy, voice } from "@claywork/golems";

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

// --- golems: a stand-in System One model with simple scripted instincts -------
const instincts: FakeRule = ({ key, question, state }) => {
  if (key !== "action" || question.type !== "choice") return undefined;
  const self = (state as { self: { state: string[] } }).self;
  const hp = Number(self.state.find((s) => s.startsWith("hp "))?.slice(3).split("/")[0] ?? 99);
  const prefer = hp <= 3 ? "go:" : "attack:";
  return Object.fromEntries(Object.keys(question.criteria).map((id) => [id, id.startsWith(prefer) ? 3 : 0]));
};
const reflex = new FakeReflex({ latencyMs: [60, 300], rules: [instincts] });
const banter = new FakeReason(["Mine! Go away!", "Shiny things... you have shiny things?", "Door stays shut. Goblin says so."], { latencyMs: 400 });

for (const thing of wheel.world.things.values()) {
  if (thing.traits.actor?.kind !== "mob" && thing.traits.actor?.kind !== "npc") continue;
  animate(wheel, thing.id, { policy: reflexPolicy(reflex, { fallback: brute() }), fallback: brute(), deadlineMs: Math.min(800, tickMs / 2) });
  voice(wheel, thing.id, banter);
}

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
  if (event.name === "looked" || (event.actor === me && event.name === "entered" && event.tick === 0)) return print(perspective(event, me));
  print(`  ${event.actor === me ? "·" : "»"} ${perspective(event, me)}`);
  if (event.actor === me && event.name === "died") {
    print("\nYou died. The clay takes you back.");
    shutdown();
  }
  if (event.actor === me && event.name === "won") {
    print("\n" + perspective(event, me));
    shutdown();
  }
}, { actor: me });

wheel.onTurn((events) => {
  if (events.some((e) => e.actor === me && ["entered", "taken", "dropped", "opened", "unlocked"].includes(e.name)) || events.some((e) => e.name === "narration")) show();
});

const meta: MetaDoc[] = [
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
