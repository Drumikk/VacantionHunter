import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { createConnectors } from "./connectors/index.js";
import { JobStore } from "./services/store.js";
import { WatchStore } from "./services/watch-store.js";
import { NotificationOutbox } from "./services/notification-outbox.js";
import { NotificationService } from "./services/notification-service.js";
import { ApplicationStore } from "./services/application-store.js";
import { JobService } from "./services/job-service.js";
import { startScheduler } from "./services/scheduler.js";

const publicDir = path.join(config.rootDir, "public");
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8" };

const store = new JobStore(config.storePath);
const watchStore = new WatchStore(config.watchStorePath);
const notificationService = new NotificationService({ outbox: new NotificationOutbox(config.notificationOutboxPath), config });
const applicationStore = new ApplicationStore(config.applicationStorePath);
const service = new JobService({ connectors: createConnectors(config), store, watchStore, notificationService, applicationStore, config });
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

function createNdjsonWriter(res) {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  let closed = false;
  let queue = Promise.resolve(true);
  res.on("close", () => { closed = true; });
  res.on("error", () => { closed = true; });

  const write = (event) => {
    queue = queue.then(async () => {
      if (closed || res.destroyed || res.writableEnded) return false;
      try {
        if (res.write(`${JSON.stringify(event)}\n`)) return true;
        return await new Promise((resolve) => {
          const cleanup = () => {
            res.off("drain", onDrain);
            res.off("close", onClose);
            res.off("error", onClose);
          };
          const onDrain = () => { cleanup(); resolve(true); };
          const onClose = () => { cleanup(); resolve(false); };
          res.once("drain", onDrain);
          res.once("close", onClose);
          res.once("error", onClose);
        });
      } catch {
        closed = true;
        return false;
      }
    });
    return queue;
  };

  return {
    get closed() { return closed || res.destroyed || res.writableEnded; },
    write,
    async end() {
      await queue;
      if (!closed && !res.destroyed && !res.writableEnded) res.end();
    },
  };
}

async function streamSearch(req, res, data) {
  const query = service.parse(data.query);
  const sort = data.sort || [];
  const limit = data.limit || 100;
  const refresh = Boolean(data.refresh);
  const totalSources = refresh ? service.getSources().filter((source) => source.refreshable).length : 0;
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  const writer = createNdjsonWriter(res);

  try {
    const initial = service.searchSnapshot(query, { sort, limit });
    const opened = await writer.write({
      type: "initial",
      response: initial,
      progress: { completed: 0, total: totalSources },
    });
    if (!opened) {
      controller.abort();
      return;
    }

    if (!refresh) {
      await writer.write({ type: "done", response: initial, progress: { completed: 0, total: 0 } });
      return;
    }

    const finalReport = await service.refresh(query, {
      signal: controller.signal,
      onProgress: async (result, progress) => {
        if (writer.closed) {
          controller.abort();
          return;
        }
        const response = result.status === "fulfilled" && result.changed
          ? service.searchSnapshot(query, { sort, limit })
          : null;
        const written = await writer.write({ type: "progress", result, progress, response });
        if (!written) controller.abort();
      },
    });
    if (controller.signal.aborted || writer.closed) return;

    await writer.write({
      type: "done",
      response: service.searchSnapshot(query, { sort, limit, refreshReport: finalReport }),
      progress: { completed: finalReport.length, total: totalSources },
    });
  } catch (error) {
    if (!writer.closed) await writer.write({ type: "error", error: error.message });
  } finally {
    await writer.end();
  }
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
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, jobs: store.jobs.length, watches: service.getWatches().length, applications: service.getApplications().summary, scope: config.sourceScope, sources: service.getSources(), notifications: service.getNotificationStatus() });
    if (req.method === "GET" && url.pathname === "/api/sources") return json(res, 200, service.getSources());
    if (req.method === "GET" && url.pathname === "/api/notifications/status") return json(res, 200, service.getNotificationStatus());
    if (req.method === "POST" && url.pathname === "/api/notifications/test") return json(res, 200, await service.sendTestNotification());
    if (req.method === "POST" && url.pathname === "/api/notifications/discover") return json(res, 200, await service.discoverNotificationChats());
    if (req.method === "POST" && url.pathname === "/api/notifications/flush") return json(res, 200, { report: await service.retryNotifications(), status: service.getNotificationStatus() });
    if (req.method === "GET" && url.pathname === "/api/watches") return json(res, 200, { watches: service.getWatches() });
    if (req.method === "GET" && url.pathname === "/api/applications") return json(res, 200, service.getApplications({ status: url.searchParams.get("status") }));
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(`event: ready\ndata: ${JSON.stringify({ jobs: store.jobs.length, watches: service.getWatches().length })}\n\n`);
      const onJobs = (payload) => res.write(`event: jobs\ndata: ${JSON.stringify(payload)}\n\n`);
      const onSource = (payload) => res.write(`event: source\ndata: ${JSON.stringify(payload)}\n\n`);
      const onWatch = (payload) => res.write(`event: watch\ndata: ${JSON.stringify(payload)}\n\n`);
      const onWatchJobs = (payload) => res.write(`event: watch-jobs\ndata: ${JSON.stringify(payload)}\n\n`);
      const onApplication = (payload) => res.write(`event: application\ndata: ${JSON.stringify(payload)}\n\n`);
      service.on("jobs", onJobs); service.on("source", onSource); service.on("watch", onWatch); service.on("watch-jobs", onWatchJobs); service.on("application", onApplication);
      req.on("close", () => { service.off("jobs", onJobs); service.off("source", onSource); service.off("watch", onWatch); service.off("watch-jobs", onWatchJobs); service.off("application", onApplication); });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/parse-query") { const data = await body(req); return json(res, 200, service.parse(data.query)); }
    if (req.method === "POST" && url.pathname === "/api/search/stream") {
      const data = await body(req);
      if (!data.query?.trim()) return json(res, 400, { error: "Введите поисковый запрос" });
      await streamSearch(req, res, data);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/search") { const data = await body(req); if (!data.query?.trim()) return json(res, 400, { error: "Введите поисковый запрос" }); return json(res, 200, await service.search({ rawQuery: data.query, sort: data.sort || [], refresh: Boolean(data.refresh), limit: data.limit || 100 })); }
    const sourceCheck = url.pathname.match(/^\/api\/sources\/([^/]+)\/check$/);
    if (req.method === "POST" && sourceCheck) { const data = await body(req); return json(res, 200, await service.checkSource(decodeURIComponent(sourceCheck[1]), data.query)); }
    if (req.method === "POST" && url.pathname === "/api/refresh") { const data = await body(req); return json(res, 202, { report: await service.refresh(data.query || service.lastQueries[0] || "работа", { sourceIds: data.sources || null }) }); }
    if (req.method === "POST" && url.pathname === "/api/verify") { const data = await body(req); return json(res, 200, { results: await service.verify(Array.isArray(data.ids) ? data.ids : []) }); }
    if (req.method === "POST" && url.pathname === "/api/watches") { const data = await body(req); return json(res, 201, { watch: await service.addWatch(data.query) }); }
    if (req.method === "POST" && url.pathname === "/api/applications") { const data = await body(req); return json(res, 201, { application: await service.addApplication(data.jobId, data) }); }
    if (["PATCH", "DELETE"].includes(req.method) && url.pathname.startsWith("/api/applications/")) {
      const jobId = decodeURIComponent(url.pathname.slice("/api/applications/".length));
      if (req.method === "PATCH") { const data = await body(req); return json(res, 200, { application: await service.updateApplication(jobId, data) }); }
      return await service.removeApplication(jobId) ? json(res, 200, { removed: true }) : json(res, 404, { error: "Вакансия не найдена в воронке" });
    }
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
