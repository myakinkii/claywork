# claywork: guide for agents

A hypertext MUD engine in TypeScript. Worlds are data, rules are code, inhabitants
("golems") are animated by models behind model-agnostic interfaces. Read `README.md`
for the player-facing picture; this file is how to work on it. Open work is in the
README's "Next" section.

## Commands

```bash
npm install
npm test            # node:test over packages/*/test and apps/*/test, fully offline (fakes)
npm run typecheck   # tsc, no emit
npm run kiln        # validate worlds/drowned-cellar.json (structure, art, walkthrough)
npm run play        # terminal client, real time
npm start           # world server + browser client, http://localhost:8080
npm run probe       # ask the configured System One model what the goblin would do
DEBUG=all npm start # or DEBUG=net,events,intents,golems
```

`npm start`, `play` and `probe` load `.env` (git-ignored; see `.env.example`). Before
committing: `npm run typecheck && npm test && npm run kiln`.

## Runtime and TypeScript rules

- Node >= 22.18 runs `.ts` natively by **type stripping**. There is no build step;
  `tsc` only type-checks. So: **erasable syntax only** (`erasableSyntaxOnly` is on): no
  `enum`, no `namespace`, no constructor parameter properties (`constructor(private x)`),
  no decorators. Use plain fields and `#private` fields.
- Relative imports use the `.ts` extension (`./world.ts`). Type-only imports use
  `import type` (`verbatimModuleSyntax`). `noUncheckedIndexedAccess` is on.
- npm workspaces: `packages/*` and `apps/*`. Packages export `./src/index.ts` directly.
- Dependencies: avoid them. If one is needed, pin an exact version published at least
  two weeks ago.

## Map of the workshop (pottery names, one job each)

| Package | Job |
| --- | --- |
| `clay` | Schemas (`types.ts`: Thing, Traits, glyph Condition/Effect/Trigger, Intent, GameEvent, Scenario, Observation, Option, DecisionPoint, Sprite) and `World`: containment tree, props, senses (`isLit`, `canSee`, `perceivable`), per-actor knowledge and memory. Stores and queries state; holds no rules. |
| `slip` | Event bus. Scopes (room/actor/global), perception at publish time, injectable `overhear` (through walls) and `adapt` (strip art for the blind). `perspective()` renders "you" for actor and target. |
| `glyphs` | Interpreter for the data-only scripting DSL: `check` conditions, `apply` effects, `fire` triggers, `pickArt`. |
| `wheel` | The single authority. Verbs (`verbs.ts`, `world-verbs.ts`), senses (`senses.ts`), the tick loop (`wheel.ts`): queue intents, resolve via verbs + glyph triggers, publish events, first-sight cut scenes, goals. |
| `kiln` | Validates scenarios: references, containment, verbs, art, reachability, then replays the walkthrough on a real wheel. Its error messages are written to be fed back to an LLM. |
| `glaze` | Surfaces: `glaze()` view model, `toText`/`toHtml`, `understand()` command parser, `help()`, art renderers (`toSvg`, `toAnsi`, `toPlain`). |
| `reflex` | System One interface (Choice/Score/Noul with probabilities), `FakeReflex`, and `SystemOneHttp` (TypeSafe System One protocol: Alibaba Model Studio, Jev, djev-run). |
| `reason` | Language-model interface, `FakeReason`. No real adapter yet. |
| `golems` | NPC minds: `Policy`, `brute`, `animate` (deadline, fallback, dormancy), `voice`, `awaken`. `mind.ts`: archetype minds, the main path: roles, role-framed perception (`frame`, `describe`), attention (`noticed`, `attentive`), standing `orders`, `mindView` (the exact state and choices sent), `mindPolicy`, `restricted`. `reflexPolicy` is the older per-option path for golems without an archetype. |
| `workshop` | Server-side, transport-agnostic: shelf of fired worlds, `Instance` (wheel + golems), `Session` (survives disconnects: link-dead), protocol types, `createDebug`. |
| `apps/server` | `ws` websocket adapter + `public/index.html` (single-file browser client). |
| `apps/terminal` | `play.ts`, `kiln.ts`, `probe.ts`, `tiles.ts` (+ `tiles-lib.ts`: fire a world's test tiles). |
| `worlds/` | `<id>.json` scenarios, optional `<id>.minds.ts` (fresh `Minds` per instance), optional `<id>.tiles.json` (test tiles). |
| `tools/art/` | Python + Pillow scripts that drew the sprites; seeded, reproducible. |

## Principles (please keep them)

1. **Intents, not mutations.** Players, rules and models only `wheel.submit(intent)`.
   Only verbs and glyph effects change the world, inside `wheel.turn()`.
2. **One decision contract.** A `DecisionPoint` (observation + persona + goal + the closed
   list of *legal* options, each with a one-line hint) goes to a `Policy`, which returns
   an option id. Humans (glaze links), rules and models are interchangeable.
3. **The wheel never waits.** Golems think asynchronously against a deadline; slow,
   failing, unsure or illegal answers fall back to rules. Never block a tick on a model.
4. **Worlds are data and are fired before use.** Anything an LLM may generate (triggers,
   verbs, art) must be data the kiln can validate. New schema features need kiln checks.
5. **Perception is per actor.** Darkness, echoes, knowledge, memory, first sights. Never
   send an actor information it could not perceive (debug mode is the exception).
6. **Models behind interfaces, fakes for tests.** Every real adapter gets a fake-backed
   test path; tests never need the network. Real adapters are chosen by env in minds files.
7. **Secrets** live in `.env` only, never in logs or errors (`SystemOneHttp` redacts the
   key; debug logs show only the first 4 characters of session tokens).

## Testing patterns

- Drive a wheel by hand: `wheel.submit(...)` then `wheel.turn()`; events come back.
- Async golems: `await turns(wheel, n)` (turn, then a short sleep) in `golems.test.ts`.
- Workshop: `new Workshop(shelf, { tickMs: 0, token: () => "t1" })` and fake `send`
  functions collecting messages (`workshop.test.ts`).
- HTTP adapters: a local `node:http` mock server (`reflex/test/http.test.ts`).
- When a test teleports actors (`world.move`) into a room with art, mark the first sight
  as seen (`world.remember(actor, "sight:<room>")`) unless the test is about art.
- The dark stairwell is the spawn: players must `search` before they can see the shovel.
- Archetype changes: run `npm run tiles` with the real model before and after. Read the README's "Minds" section first: the decision model is a matcher, and wording decides behavior.

## Style

Code comments explain *why*, briefly. User-facing text (event text, errors, kiln cracks)
is plain, specific and in the world's voice; errors say what to do next. Prefer small,
composable functions over frameworks.
