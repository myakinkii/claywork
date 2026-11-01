import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { WebSocketServer, type WebSocket } from "ws";
import { Workshop, silent, type ClientMessage, type Debug } from "@claywork/workshop";

const CLIENT = new URL("../public/index.html", import.meta.url);

/** Accept only well-formed messages; anything else is ignored. */
export function parseMessage(raw: string): ClientMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== "object" || m === null) return null;
  const o = m as Record<string, unknown>;
  const str = (k: string, max = 500) => typeof o[k] === "string" && (o[k] as string).length <= max;
  switch (o.type) {
    case "hello":
      return o.token === undefined || str("token", 64) ? (o as ClientMessage) : null;
    case "start":
      return str("world", 64) && str("name", 64) ? (o as ClientMessage) : null;
    case "join":
      return str("instance", 64) && str("name", 64) ? (o as ClientMessage) : null;
    case "command":
      return str("text") ? (o as ClientMessage) : null;
    case "option":
      return str("id", 200) ? (o as ClientMessage) : null;
    case "leave":
      return o as ClientMessage;
    default:
      return null;
  }
}

export interface ServeOptions {
  port: number;
  /** Default 127.0.0.1: only this machine. Use 0.0.0.0 to let others on your network play. */
  host?: string;
  debug?: Debug;
}

/**
 * Serve the client page, a /health check and the /ws endpoint. A connection must say
 * hello first (with its token, if it has one) so link-dead bodies can be picked up again.
 *
 * Listening is asynchronous: wait for "listening" before announcing anything, and handle
 * "error" (a taken port is the usual one).
 */
export function serve(workshop: Workshop, options: ServeOptions): Server {
  const debug = options.debug ?? silent;
  const http = createServer((req, res) => {
    try {
      if (req.url === "/" || req.url?.startsWith("/?")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
        res.end(readFileSync(CLIENT));
        return;
      }
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, worlds: workshop.shelf.length, instances: workshop.instances.size, sessions: workshop.sessions.size }));
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" }).end("Not here.");
    } catch (e) {
      console.error(`Request ${req.method} ${req.url} failed:`, e);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end("Something broke on the server. Its console says what.");
    }
  });

  const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 4096 });
  // The http server reports listen errors; ws re-emits them here, and an unhandled one would crash.
  wss.on("error", () => {});
  wss.on("connection", (socket: WebSocket, req) => {
    debug.log("net", `websocket from ${req.socket.remoteAddress}`);
    let session: ReturnType<Workshop["connect"]> | undefined;
    const send = (message: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    socket.on("message", (data) => {
      const message = parseMessage(data.toString());
      if (!message) return;
      if (!session) {
        if (message.type !== "hello") return;
        session = workshop.connect(send, message.token);
        return;
      }
      workshop.receive(session, message);
    });
    socket.on("close", () => {
      if (session) workshop.disconnect(session);
    });
  });

  http.listen(options.port, options.host ?? "127.0.0.1");
  return http;
}
