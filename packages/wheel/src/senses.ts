import type { GameEvent, Id, World } from "@claywork/clay";
import type { Overhear } from "@claywork/slip";

/** Loud things carry through walls even when nobody is listening. */
const LOUD = new Set(["attacked", "died"]);

/**
 * Hearing through walls. A room with an `echo` trait hears events from another room:
 * speech arrives muffled, loud things arrive as thuds, quiet things not at all.
 * An actor who is listening hears it all clearly, words included.
 *
 * Overheard events are re-scoped to the listener's room and stripped of their actor,
 * so nobody is ever told "You say..." about something heard through a wall.
 */
export function overhear(world: World): Overhear {
  return (event, actor) => {
    if (event.scope.kind !== "room" || !world.has(actor)) return null;
    const room = world.roomOf(actor);
    if (!room) return null;
    const echo = world.get(room).traits.echo;
    if (!echo || echo.from !== event.scope.room) return null;

    const listening = world.prop(actor, "actor.listening") === true;
    const heard = (text: string): GameEvent => ({
      tick: event.tick,
      name: "overheard",
      scope: { kind: "actor", actor },
      text,
      data: { original: event.name, from: event.scope.kind === "room" ? event.scope.room : null, },
    });

    if (event.name === "said") {
      // You hear the words, not who spoke them: a voice through a wall stays a mystery.
      const words = event.data?.words;
      return heard(
        listening && typeof words === "string"
          ? `Through the wall, a voice: "${words}"`
          : (echo.muffled ?? "Through the wall, you hear a muffled voice, too faint to make out."),
      );
    }
    if (listening) return heard(`Through the wall: ${event.text}`);
    if (LOUD.has(event.name)) return heard("Something thuds against the other side of the wall.");
    return null;
  };
}

/** Pictures need eyes: in the dark, or blind, you get the words without the art. */
export function sight(world: World) {
  return (event: GameEvent, actor: Id): GameEvent => {
    if (!event.art || !world.has(actor) || world.canSee(actor)) return event;
    const { art: _art, ...blind } = event;
    return blind;
  };
}

/** Verbs that keep an actor still: they count stillness up, and keep it listening. */
export const STILL_VERBS = new Set(["wait", "listen"]);

export function isStill(world: World, actor: Id): number {
  const still = world.prop(actor, "actor.still");
  return typeof still === "number" ? still : 0;
}
