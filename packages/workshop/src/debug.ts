/**
 * Debug output, by topic. Enable with DEBUG=all (or 1), or a list: DEBUG=events,golems.
 *
 *   net      connections, sessions, lobby actions
 *   events   every world event, unfiltered by perception, with its scope
 *   intents  every intent submitted, by players and golems alike
 *   golems   every golem decision: what, why, confidence, how long it took
 */
export const TOPICS = ["net", "events", "intents", "golems"] as const;
export type Topic = (typeof TOPICS)[number];

export interface Debug {
  on(topic: Topic): boolean;
  log(topic: Topic, line: string): void;
}

export const silent: Debug = { on: () => false, log: () => {} };

export function createDebug(spec: string | undefined, write: (line: string) => void = (l) => process.stderr.write(`${l}\n`)): Debug {
  if (!spec) return silent;
  const wanted = spec.split(",").map((s) => s.trim().toLowerCase());
  const all = wanted.includes("all") || wanted.includes("1") || wanted.includes("true");
  const enabled = new Set<string>(all ? TOPICS : wanted.filter((w) => (TOPICS as readonly string[]).includes(w)));
  const start = Date.now();
  return {
    on: (topic) => enabled.has(topic),
    log(topic, line) {
      if (!enabled.has(topic)) return;
      const t = ((Date.now() - start) / 1000).toFixed(1).padStart(7);
      write(`${t}s ${topic.padEnd(7)} ${line}`);
    },
  };
}
