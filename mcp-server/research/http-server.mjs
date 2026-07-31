#!/usr/bin/env node
/**
 * http-server.mjs — the hosted transport.
 *
 * Same servers, same tools, same corpus. The only thing that changes is how a
 * client reaches them: Streamable HTTP instead of stdio.
 *
 * WHY THIS EXISTS, and why it is the right shape rather than a workaround for a
 * client that would not connect:
 *
 *  1. A RUN THAT LASTS DAYS MUST NOT DEPEND ON A LAPTOP STAYING AWAKE. With a
 *     stdio server the research process is a child of whatever client spawned
 *     it. Close the lid, quit the app, and the run dies mid-phase. Hosted, the
 *     corpus and the process live on a machine that stays up, and the client is
 *     just something that talks to it — any client, from anywhere, including one
 *     that connects tomorrow.
 *
 *  2. EVERY MCP CLIENT SPEAKS HTTP. stdio requires the client to be able to
 *     spawn a local process with a working Node on the same filesystem. A
 *     sandboxed or VM-backed client cannot. An HTTPS URL works everywhere.
 *
 *  3. A CLIENT CAN BE GIVEN ACCESS without installing anything.
 *
 * AUTH. The endpoint requires a bearer token. This is not decoration: the tools
 * make outbound requests against rate-limited and quota-limited APIs, and write
 * to a corpus. An open endpoint would let anyone burn the quotas and poison the
 * ledger. Set RESEARCH_AUTH_TOKEN; the server refuses to start without one
 * rather than starting insecurely.
 *
 * Endpoints:
 *   POST/GET/DELETE /mcp     — the research server (Streamable HTTP)
 *   POST/GET/DELETE /thesis  — the thesis server
 *   GET  /health             — liveness + run status, no auth (no corpus data)
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createServer as createResearchServer } from "./research-mcp.mjs";
import { createServer as createThesisServer } from "./thesis-mcp.mjs";
import { CORPUS_DIR } from "./corpus.mjs";

const PORT = Number(process.env.PORT || process.env.RESEARCH_HTTP_PORT || 8848);
const HOST = process.env.RESEARCH_HTTP_HOST || "127.0.0.1";
const TOKEN = process.env.RESEARCH_AUTH_TOKEN;

if (!TOKEN || TOKEN.length < 16) {
  console.error(
    "REFUSING TO START: RESEARCH_AUTH_TOKEN is missing or shorter than 16 characters.\n" +
      "These tools make outbound requests against quota-limited APIs and write to a corpus.\n" +
      "An unauthenticated endpoint would let anyone exhaust those quotas and poison the ledger.\n" +
      "Generate one with:  openssl rand -hex 32",
  );
  process.exit(1);
}

/** Constant-time-ish compare so the token cannot be probed by timing. */
function tokenOk(header) {
  const given = String(header || "").replace(/^Bearer\s+/i, "");
  if (given.length !== TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < TOKEN.length; i++) diff |= given.charCodeAt(i) ^ TOKEN.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// One transport per session, per server. The SDK's Streamable HTTP transport is
// stateful: a client initialises, gets a session id back, and sends it on every
// subsequent request. Holding them in a map is what lets a long-running client
// keep one logical connection across many HTTP requests.
// ---------------------------------------------------------------------------

const sessions = { research: new Map(), thesis: new Map() };

async function transportFor(kind, req) {
  const sid = req.headers["mcp-session-id"];
  const pool = sessions[kind];

  if (sid && pool.has(sid)) return pool.get(sid);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      pool.set(id, transport);
      console.log(`[${new Date().toISOString()}] ${kind} session opened: ${id} (${pool.size} active)`);
    },
    onsessionclosed: (id) => {
      pool.delete(id);
      console.log(`[${new Date().toISOString()}] ${kind} session closed: ${id} (${pool.size} active)`);
    },
    // The research loop can sit quiet for minutes while a source is paged or a
    // rate limiter waits. Without keepalives an intermediary will drop the
    // stream and the client will think the server died.
    keepAliveMs: 25000,
    enableDnsRebindingProtection: false,
  });

  // A fresh server per session: an MCP Server binds to one transport only, so
  // sharing a singleton would refuse every client after the first.
  const mcp = kind === "research" ? createResearchServer() : createThesisServer();
  await mcp.connect(transport);
  return transport;
}

// ---------------------------------------------------------------------------

function health() {
  const projects = [];
  try {
    if (existsSync(CORPUS_DIR)) {
      for (const name of readdirSync(CORPUS_DIR, { withFileTypes: true })) {
        if (!name.isDirectory()) continue;
        const statusFile = join(CORPUS_DIR, name.name, "run-status.json");
        if (!existsSync(statusFile)) {
          projects.push({ project: name.name, state: "no run status yet" });
          continue;
        }
        const st = JSON.parse(readFileSync(statusFile, "utf8"));
        const ageMs = Date.now() - new Date(st.updated).getTime();
        projects.push({
          project: name.name,
          state: st.state,
          last_beat: st.updated,
          seconds_since_beat: Math.round(ageMs / 1000),
          // The number that tells you alive-and-moving from wedged.
          moving: st.delta_since_last_beat || null,
          progress: st.progress || null,
          timing: st.timing || null,
        });
      }
    }
  } catch (e) {
    return { ok: true, corpus_dir: CORPUS_DIR, projects_error: String(e.message || e) };
  }
  return {
    ok: true,
    server: "research-mcp",
    transport: "streamable-http",
    corpus_dir: CORPUS_DIR,
    uptime_seconds: Math.round(process.uptime()),
    active_sessions: { research: sessions.research.size, thesis: sessions.thesis.size },
    projects,
  };
}

// ---------------------------------------------------------------------------

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname.replace(/\/$/, "") || "/";

  // Health is unauthenticated on purpose — it exposes run state, never corpus
  // content, so it can be pointed at by an uptime monitor.
  if (path === "/health" || path === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(health(), null, 2));
  }

  if (!tokenOk(req.headers.authorization)) {
    res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
    return res.end(JSON.stringify({ error: "unauthorized", hint: "Send Authorization: Bearer <RESEARCH_AUTH_TOKEN>" }));
  }

  const kind = path === "/thesis" ? "thesis" : path === "/mcp" ? "research" : null;
  if (!kind) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "not found", endpoints: ["/mcp", "/thesis", "/health"] }));
  }

  try {
    const transport = await transportFor(kind, req);
    await transport.handleRequest(req, res);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] ${kind} request failed:`, e);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e?.message || e) }));
    }
  }
});

// A long research run holds a stream open for a long time; do not let Node's
// defaults cut it.
httpServer.requestTimeout = 0;
httpServer.headersTimeout = 0;
httpServer.keepAliveTimeout = 76000;

httpServer.listen(PORT, HOST, () => {
  console.log(`research-mcp (http) listening on http://${HOST}:${PORT}`);
  console.log(`  corpus:  ${CORPUS_DIR}`);
  console.log(`  mcp:     POST http://${HOST}:${PORT}/mcp      (research, 24 tools)`);
  console.log(`  thesis:  POST http://${HOST}:${PORT}/thesis   (thesis, 8 tools)`);
  console.log(`  health:  GET  http://${HOST}:${PORT}/health   (no auth)`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`\n${sig} — closing.`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

// A hosted server must not die because one request threw.
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
