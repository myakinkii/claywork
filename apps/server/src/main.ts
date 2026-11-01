// Start the world server.
// Usage: npm start ; env PORT=8080 HOST=127.0.0.1 TICK_MS=2000 DEBUG=all|net,events,intents,golems
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { Workshop, createDebug, loadWorlds, TOPICS } from "@claywork/workshop";
import { serve } from "./server.ts";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "127.0.0.1";
const tickMs = Number(process.env.TICK_MS ?? 2000);
const debug = createDebug(process.env.DEBUG);
const dir = fileURLToPath(new URL("../../../worlds/", import.meta.url));

const { shelf, rejected } = await loadWorlds(dir);
for (const r of rejected) {
  console.warn(`✗ ${r.file} did not fire clean and stays off the shelf:`);
  for (const c of r.cracks) console.warn(`    [${c.code}] ${c.message}`);
}
const workshop = new Workshop(shelf, { tickMs, debug });
const server = serve(workshop, { port, host, debug });

server.on("listening", () => {
  const { address, port: actual } = server.address() as AddressInfo;
  const shown = address === "127.0.0.1" || address === "::1" ? "localhost" : address;
  console.log(`claywork: ${shelf.length} world(s) on the shelf, ticking every ${tickMs}ms`);
  console.log(`listening on ${address}:${actual}, open http://${shown}:${actual}`);
  const on = TOPICS.filter((t) => debug.on(t));
  console.log(on.length ? `debug: ${on.join(", ")}` : "debug: off (DEBUG=all to see world events, intents and golem decisions)");
});

server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`✗ Port ${port} on ${host} is already taken by another program, so nothing was started.`);
    console.error(`  If curl gave you an empty reply, that other program answered. See who it is: lsof -iTCP:${port} -sTCP:LISTEN`);
    console.error(`  Or pick another port: PORT=${port + 10} npm start`);
  } else if (e.code === "EACCES") {
    console.error(`✗ Not allowed to listen on port ${port}. Ports below 1024 need extra rights; try PORT=8080.`);
  } else {
    console.error(`✗ The server could not start: ${e.message}`);
  }
  workshop.close();
  process.exit(1);
});

const shutdown = () => {
  workshop.close();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
