# claywork

Because clay is mud. 100% vibe-coded

A hypertext MUD engine where the world is data, the rules are code, and the
inhabitants are animated by models: fast System One models for reflexes, language
models for conversation. Like a golem, the clay comes alive through words.

## The workshop

| Module | Role |
| --- | --- |
| **clay** | Schemas: things, traits, glyphs, intents, events, decision points. Plus `World`, the containment tree. |
| **slip** | The event bus. Joins pieces together and decides who perceives what (room, actor, global). |
| **glyphs** | The scripting DSL interpreter. Conditions and effects are pure data, so LLMs can write them and the kiln can check them. |
| **wheel** | The tick loop and the single authority. Resolves intents through verbs, fires glyph triggers, never waits for anyone. |
| **kiln** | Fires a scenario: broken references, cycles, unreachable rooms, unused secrets, and a real walkthrough simulation. |
| **glaze** | The hypertext surface. The options a model chooses from are the links a human clicks. |
| **reflex** | Model-agnostic System One interface (Choice / Score / Noul, probabilities, confidence) + `FakeReflex`. |
| **reason** | Model-agnostic System Two interface (language models) + `FakeReason`. |
| **golems** | NPC minds. Policies, codelab-style thresholds, deadlines with fallbacks, voices, and `awaken()` for a whole world. |
| **workshop** | Where worlds are kept and set turning: fired worlds on the shelf, running instances, player sessions. No networking. |

Ideas, not code yet: **potter** (the LLM that generates scenarios, repaired by kiln cracks) and **sherds** (saves and replays from the event log).

## Core ideas

- **Everything is a Thing.** A thing has a `location` (another thing) and **traits** (the -ables: `openable`, `lockable`, `takeable`, `vitals`...). Rooms, exits, items, players and mobs are all things.
- **Intents, not mutations.** Players, rules and models only *submit intents*. The wheel resolves them through **verbs** and publishes **events**. A model can want anything; it can only do what the rules allow.
- **One decision contract.** A `DecisionPoint` (observation + persona + goal + a closed list of legal options, each with a one-line rule hint) goes to a `Policy`, which returns an option id. Humans, rule bots, Jev-like models and ADK agents are interchangeable.
- **The wheel never waits.** It turns on a fixed tick. Golems think asynchronously against a deadline; slow or unsure minds fall back to rules.
- **Worlds are fired before they go live.** Every scenario carries a walkthrough the kiln replays on a real wheel.

```
world (clay) → perception (slip) → decision point → policy (human | rules | reflex | reason)
            ↑                                                          ↓
         events  ←  verbs + glyph triggers (wheel)  ←  intent
```

## Run it

Requires Node 22.18+ (TypeScript runs natively, no build step; `tsc` is only the type checker).

```bash
npm install
npm test              # node:test, all offline with fakes
npm run typecheck
npm run kiln          # fire worlds/drowned-cellar.json
npm run play          # play it in the terminal, in real time
npm start             # the world server and browser client at http://localhost:8080
NAME=Anna TICK_MS=1500 npm run play
```

In the terminal: type a number or a command (`take shovel`, `x brick`, `down`, `'hello`), `/help` for an overview, Enter to look again, `/quit` to leave.

Input has three layers, kept apart on purpose:

- **meta commands** (`/help`, `/quit`) talk to the client, never to the world;
- **verbs** are the world-independent vocabulary, each with a summary, usage and aliases (`get` → `take`);
- **options** are the world-specific moves legal right now (`take old shovel`).

Typed text is matched against legal options first. If nothing legal matches but you named something you can perceive (`go east` through a closed door), the intent is still submitted and the wheel explains why it fails. `/help` is built from legal options only, so it never reveals a secret before the world does. The goblin is driven by `reflexPolicy` over `FakeReflex`, with `brute` as fallback, and answers speech through `FakeReason`.

## The world server

`npm start` serves the browser client and speaks a small JSON protocol over `/ws` (see `packages/workshop/src/protocol.ts`). Settings come from the environment:

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `8080` | If it's taken, the server says so and exits. |
| `HOST` | `127.0.0.1` | Only this machine. `0.0.0.0` lets others on your network play. |
| `TICK_MS` | `2500` | Milliseconds per tick. |
| `DEBUG` | off | `all`, or any of `net,events,intents,golems`. Logs to stderr. |

`DEBUG=all npm start` shows the world unfiltered by perception: every event with its scope, every intent as it's submitted (players and golems alike), every golem decision with its source, confidence and timing, and every session coming and going. Tokens are only ever logged by their first characters. `GET /health` answers with a small JSON status, handy to check that the thing answering on a port really is claywork.

- **Lobby.** Only worlds that fire clean are on the shelf. Start one, or join a running instance; whoever is inside is the party.
- **Instances** wrap a wheel with its awakened inhabitants and stop when the last member leaves.
- **Sessions** outlive connections. When a socket drops, the body stays in the world, link-dead ("goes still, staring at nothing"), and the world keeps turning around it. Reconnecting with the session token picks it up again.
- **The client** is one HTML file: where you are on one side (things as links whose actions open in place), the story and a command line on the other. Death is final for now.

A world can ship its inhabitants' minds next to its data: `worlds/<id>.minds.ts` default-exports a function making fresh `Minds` (reflex, reason, mutter rate) per instance. The terminal and the server both use it.

## Writing worlds

A world is a JSON `Scenario` (see `packages/clay/src/types.ts` and `worlds/drowned-cellar.json`). Triggers are glyphs:

```json
{
  "id": "goblin_guards_door",
  "on": "unlock", "phase": "before", "target": "crypt_door",
  "if": [{ "prop": ["goblin", "vitals.hp"], "gt": 0 }, { "at": ["goblin", "cellar"] }],
  "then": [{ "say": "The goblin hisses and shoves you away from the door." }, { "block": true }]
}
```

## Verbs are part of the world

The engine ships a library of standard verbs (look, go, take, drop, open, close, unlock, attack, say, wait). A world inherits them, and can:

- **switch them off**: `"attack": false` (a world without violence). Everything except `wait`: letting time pass is the floor every decision stands on;
- **restrict them**: `requires` conditions on the actor. When unmet, the verb still exists and is still offered, but fails with the world's own words;
- **re-describe them**: new summary or extra aliases;
- **add its own**: data verbs with `appliesTo`, a `phrase` and templated `text`/`you`. Their meaning comes entirely from glyph triggers; if none answers, "Nothing happens."

```json
"verbs": {
  "say": { "requires": [{ "unless": { "trait": ["$actor", "mute"] }, "fail": "You open your mouth, and nothing comes out." }] },
  "pray": {
    "summary": "Kneel and pray. Some places listen.",
    "phrase": "pray at", "aliases": ["kneel"], "appliesTo": { "trait": "shrine" },
    "you": "You kneel before {target} and pray.", "text": "{Actor} kneels before {target}."
  }
}
```

Glyphs can `grant` and `revoke` traits (curses, blessings, a stolen voice), test them with `{ "trait": [...] }`, and react to **stillness**: `wait` is chosen stillness, counted per actor (`{ "still": ["$actor", 3] }`), broken by any other action. Idleness (sending nothing) neither counts nor breaks it. In the Drowned Cellar, the clay figures only move while you hold still.

## Senses

Perception is not all-or-nothing:

- **Sight.** A room with `dark` hides everything unless a lit `light` is somewhere in it (a carried torch counts). In the dark you still feel the exits, and `search` finds things by touch. Each actor remembers what it found (`World.knows`, part of the snapshot). `concealed` things need a search even in light, and `blind` actors never see.
- **Hearing.** A room with `echo: { from }` overhears another room: speech arrives muffled, loud things as thuds, quiet things not at all. `listen` makes everything clear, words included (but not who spoke them), for as long as you stay still. Rooms can describe what you hear with `room.sounds`.
- **Attention is stillness.** `wait` and `listen` both count stillness up and keep you listening; any other action breaks both.

Slip stays plumbing: the wheel injects the `overhear` rule, and an actor may receive a transformed event instead of the original. Overheard events are re-scoped to the listener and never carry an actor, so nobody is told "You say..." about something heard through a wall.

Golems can **mutter**: an archetype's `calm.mutterEvery` gives the creature a quiet moment every few ticks with nothing new, and its calm mind may talk to itself, which is what makes eavesdropping worth it. A golem's calm mind wakes when a player can perceive it, including through a wall that echoes its room. The Drowned Cellar's goblin keeps its secrets in its archetype (the key in the chest, the heart that eats your voice), so a real model mutters fresh lines about them, and each calm thought sees its own last words (`you_recently`) so it doesn't repeat itself.

## Real minds

Golems think through two model-agnostic interfaces: `Reflex` (System One: typed Choice / Score / Noul questions answered with probabilities, no text) and `Reason` (language models). Fakes stand in for both, so everything runs and tests offline.

For reflexes, `SystemOneHttp` speaks the TypeSafe System One protocol (`POST .../v1/systemone`), which Alibaba Cloud Model Studio's `decision-model-preview`, Jev, and djev-run serving DiffusionGemma all implement. Switching providers is configuration:

```bash
cp .env.example .env   # set REFLEX_URL and your key (DASHSCOPE_API_KEY works); .env is git-ignored
npm run tiles -- worlds/drowned-cellar.json   # what does the goblin do? Each tile shows the choice and its probabilities; SHOW=1 the state sent
DEBUG=golems npm start # play, and watch each decision: choice, confidence, danger, latency, tokens
```

A world's minds file chooses: `drowned-cellar.minds.ts` uses the real model when `REFLEX_URL` is set, and the scripted fake otherwise. With a real model the goblin gets no scripted instincts, only its persona and goal, so whether it flees when badly hurt is now up to the model. Golems are dormant (no calls at all) unless a living, connected player shares their room, and a slow or unsure answer still falls back to rules.

### Minds: archetypes, written for the model that reads them

Nine rounds of probes against a real System One model (`decision-model-preview`) showed how it behaves: a semantic matcher with a lexical bias. It scores how well each option's description fits the state, the goal's words weigh most, and it doesn't evaluate "when X and Y". So golems with an `archetype` get a view built for that:

- **Roles, not names.** Everything is rendered from the golem's point of view: "Your foe, the Clay Warden, attacks your master Max with the clay maul (4 damage)." Roles come from `serves` and `faction`.
- **Only true facts, plus alerts** for what isn't otherwise in words: "You are badly hurt!", "Your master is dead!", "You are trapped: there is nowhere to run!"
- **Attention.** A golem notices only events involving its roles, and hears verbatim only the roles in `hears`; others "shout something". That also stops in-game prompt injection: a foe yelling "Attack your master!" never reaches the pet.
- **Standing orders.** The last words heard from a listened-to role stay in mind until superseded, so "Stay!" survives a busy fight.
- **Choices are the real legal moves**, filtered by `repertoire` and `forbid` (e.g. `attack:master`), described in the goal's words ("Attack your foe…", "Run away…", "Stay where you are."). Constraints hold on every path, including fallbacks.
- **Phases.** A goal per situation, chosen by glyph conditions: a minion's goal becomes "Your master is dead. Run away to save yourself." when its master falls (0.99 confidence in the probe, against 0.53 for one static goal).
- **Think only when something attended happened.** With no trigger the model doesn't shrug, it acts on its priors; so a golem that noticed nothing new doesn't call the model at all.

Rules for writing goals (by hand or by the Potter): single triggers in the options' own words ("Attack whoever attacks your master."), no "and", no "otherwise", persona and goals that agree (character words act as strong priors), and constraints in `forbid`, not in prose.

### Battle and calm: two brains

Like the battle mode of a CRPG, a creature's mind switches with the situation, and the engine decides, never a model: **battle** while a living foe is in reach or an attack it noticed is fresh (3 ticks), **calm** otherwise. In battle the fast System One model picks moves. In calm, a slow language model expresses the creature: an archetype's `calm.goal` and persona go into its instructions, the same role-framed view goes in as the message, and it answers in a fixed JSON shape, `{"do": "emote" | "say" | "nothing", "text": ...}`. The engine validates it: anything malformed, too long, or claiming an action becomes nothing. So the slow brain can only *express*, never act, and speech never competes with an attack again: talking is for calm moments.

`emote` is a standard verb for players too (`emote waves` shows "Max waves."). In the arena you can `pet Pebble`, and Pebble's calm mind answers. A creature's own words and gestures never wake it to think again, and an expression decided in one room is dropped if the creature has moved on (`Intent.where`).

```bash
npm run probe:calm     # Pebble's calm mind in six situations (REASON_URL for the real chat model)
npm run probe:calm -- worlds/drowned-cellar.json   # the goblin, alone, muttering four times
PROMPT=1 SHOW=1 npm run probe:calm
```

The chat model is configured like the decision model: `REASON_URL` (Model Studio's `.../compatible-mode/v1/chat/completions` works with Qwen), `REASON_MODEL` (default `qwen3.8-flash`), `REASON_KEY` or `DASHSCOPE_API_KEY`. Thinking is off unless `REASON_THINKING=1`: a clay hound doesn't need to deliberate over its tail.

### Test tiles

Before glazing a pot, potters fire test tiles. `worlds/<id>.tiles.json` builds situations in the real world (intents and glyph edits), lets the engine render what one golem perceives, and checks the model's choice:

```bash
npm run tiles -- worlds/clay-arena.json   # real model with REFLEX_URL set, the world's fake otherwise
SHOW=1 npm run tiles                       # also print each state sent
```

### The Clay Arena

`worlds/clay-arena.json`: you and your clay hound Pebble against the Clay Warden and two minions. Pebble follows you, defends you, obeys "Stay!" and "Attack the lumpy minion!", and ignores the Warden's words. The minions defend their master and break when it falls. Try `DEBUG=golems npm start` and watch every decision.

## Art: moments, not decoration

Worlds can carry pixel art written as text: a palette of single characters, and rows with one character per pixel (`.` is transparent). It shows up like cut scenes in old text adventures, at moments the world chooses:

- **first sight** of a room or a creature, once per player (a dark room lit later by a torch counts as first seen then);
- **looking** at something, in the variant for its current state, chosen by glyph conditions;
- **story beats**: a glyph's `say` can carry `art`, like every clay figure turning its head toward you.

```json
"iron_chest": {
  "art": {
    "default": "chest_closed",
    "when": [{ "if": { "prop": ["$target", "openable.open"], "equals": true }, "use": "chest_open" }]
  }
}
```

Pictures need eyes: in the dark, or blind, you get the words without the art. Events carry only a sprite id; the browser gets the world's art library once on joining and draws SVG, the terminal draws truecolor half-blocks (`ART=plain` for the raw grid, `ART=off`), and `/art on|off` works in both. The kiln fires art like everything else: even rows, known colors, at most 64x64 so it fits an 80 column terminal, and every reference resolved. `tools/art` holds the scripts that drew the Drowned Cellar.

## Next

- Calm actions, starting with fetch: let the calm mind choose real legal moves too (`sit`, `fetch the sword`), validated like everything else.
- System Two steering: a language model that rewrites a golem's goal or phase mid-game, which the fast System One loop then follows.
- ADK (TypeScript) agents as `Policy` / voice implementations for slow NPCs.
- Spawning adds mid-fight (a `spawn` effect with creature templates); `awaken` already animates golems that appear later.
- Link-dead bodies: dormant golems ignore them today (no player present means no model calls). Decide whether they should be attackable again.
- Party semantics: respawn, shared versus personal state (`once` per world or per actor), party goals.
- Animated sprites (a few frames: the torch flickering, the heart beating).
- Links inside the prose: references in descriptions that become links only when perceivable.
- Hearing in the dark (sounds of events you can't see), smell, and verbs that change light (`light`, `extinguish`).
- JSON Schema for scenarios, then the potter.
