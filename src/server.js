import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { createConnectors } from "./connectors/index.js";
import { JobStore } from "./services/store.js";
import { WatchStore } from "./services/watch-store.js";
import { JobService } from "./services/job-service.js";
import { startScheduler } from "./services/scheduler.js";

const publicDir = path.join(config.rootDir, "public");
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8" };

const store = new JobStore(config.storePath);
const watchStore = new WatchStore(config.watchStorePath);
const service = new JobService({ connectors: createConnectors(config), store, watchStore, config });
await service.initialize();
startScheduler(service, config.refreshIntervalMs);

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let value = "";
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 1_000_000) throw new Error("Request body too large");
  }
  return value ? JSON.parse(value) : {};
}

async function serveStatic(urlPath, res) {
  const requested = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.slice(1));
  const resolved = path.resolve(publicDir, requested);
  if (!resolved.startsWith(publicDir)) return json(res, 403, { error: "Forbidden" });
  try {
    const content = await fs.readFile(resolved);
    // Assets are intentionally unhashed in the dependency-free MVP, so every file
    // must be revalidated. A long max-age would mix a new HTML document with stale JS.
    res.writeHead(200, { "Content-Type": contentTypes[path.extname(resolved)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(content);
  } catch (error) { json(res, error.code === "ENOENT" ? 404 : 500, { error: error.message }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, jobs: store.jobs.length, watches: service.getWatches().length, scope: config.sourceScope, sources: service.getSources() });
    if (req.method === "GET" && url.pathname === "/api/sources") return json(res, 200, service.getSources());
    if (req.method === "GET" && url.pathname === "/api/watches") return json(res, 200, { watches: service.getWatches() });
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(`event: ready\ndata: ${JSON.stringify({ jobs: store.jobs.length, watches: service.getWatches().length })}\n\n`);
      const onJobs = (payload) => res.write(`event: jobs\ndata: ${JSON.stringify(payload)}\n\n`);
      const onSource = (payload) => res.write(`event: source\ndata: ${JSON.stringify(payload)}\n\n`);
      const onWatch = (payload) => res.write(`event: watch\ndata: ${JSON.stringify(payload)}\n\n`);
      const onWatchJobs = (payload) => res.write(`event: watch-jobs\ndata: ${JSON.stringify(payload)}\n\n`);
      service.on("jobs", onJobs); service.on("source", onSource); service.on("watch", onWatch); service.on("watch-jobs", onWatchJobs);
      req.on("close", () => { service.off("jobs", onJobs); service.off("source", onSource); service.off("watch", onWatch); service.off("watch-jobs", onWatchJobs); });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/parse-query") { const data = await body(req); return json(res, 200, service.parse(data.query)); }
    if (req.method === "POST" && url.pathname === "/api/search") { const data = await body(req); if (!data.query?.trim()) return json(res, 400, { error: "Введите поисковый запрос" }); return json(res, 200, await service.search({ rawQuery: data.query, sort: data.sort || [], refresh: Boolean(data.refresh), limit: data.limit || 100 })); }
    const sourceCheck = url.pathname.match(/^\/api\/sources\/([^/]+)\/check$/);
    if (req.method === "POST" && sourceCheck) { const data = await body(req); return json(res, 200, await service.checkSource(decodeURIComponent(sourceCheck[1]), data.query)); }
    if (req.method === "POST" && url.pathname === "/api/refresh") { const data = await body(req); return json(res, 202, { report: await service.refresh(data.query || service.lastQueries[0] || "работа", { sourceIds: data.sources || null }) }); }
    if (req.method === "POST" && url.pathname === "/api/verify") { const data = await body(req); return json(res, 200, { results: await service.verify(Array.isArray(data.ids) ? data.ids : []) }); }
    if (req.method === "POST" && url.pathname === "/api/watches") { const data = await body(req); return json(res, 201, { watch: await service.addWatch(data.query) }); }
    const watchAction = url.pathname.match(/^\/api\/watches\/([^/]+)\/(acknowledge|refresh)$/);
    if (req.method === "POST" && watchAction) {
      const id = decodeURIComponent(watchAction[1]);
      return watchAction[2] === "acknowledge"
        ? json(res, 200, { watch: await service.acknowledgeWatch(id) })
        : json(res, 200, await service.refreshWatch(id));
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/api/watches/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/watches/".length));
      return await service.removeWatch(id) ? json(res, 200, { removed: true }) : json(res, 404, { error: "Наблюдение не найдено" });
    }
    if (req.method === "GET") return serveStatic(url.pathname, res);
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    return json(res, error.statusCode || (error instanceof SyntaxError ? 400 : 500), { error: error.message });
  }
});

server.listen(config.port, config.host, () => console.log(`VacationHunter: http://${config.host}:${config.port}`));
