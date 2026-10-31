# claywork

Because clay is mud.

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
| **golems** | NPC minds. Policies, codelab-style thresholds, deadlines with fallbacks, and voices. |

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
NAME=Anna TICK_MS=1500 npm run play
```

In the terminal: type a number or a command (`take shovel`, `x brick`, `down`, `'hello`), `/help` for an overview, Enter to look again, `/quit` to leave.

Input has three layers, kept apart on purpose:

- **meta commands** (`/help`, `/quit`) talk to the client, never to the world;
- **verbs** are the world-independent vocabulary, each with a summary, usage and aliases (`get` → `take`);
- **options** are the world-specific moves legal right now (`take old shovel`).

Typed text is matched against legal options first. If nothing legal matches but you named something you can perceive (`go east` through a closed door), the intent is still submitted and the wheel explains why it fails. `/help` is built from legal options only, so it never reveals a secret before the world does. The goblin is driven by `reflexPolicy` over `FakeReflex`, with `brute` as fallback, and answers speech through `FakeReason`.

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

## Next

- Real adapters behind `Reflex` (a Jev / djev-run HTTP client) and `Reason` (any LLM API), keeping the fakes for tests.
- ADK (TypeScript) agents as `Policy` / voice implementations for slow NPCs.
- The deliberation gate: a Noul answer that wakes System Two to update a golem's goal.
- A world server (websocket) with glaze rendered in the browser.
- JSON Schema for scenarios, then the potter.
