export async function refreshWatchedQueries(service) {
  const normalize = (query) => String(query || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
  const watches = (service.getWatches?.() || []).slice(0, 25);
  const watchedQueries = new Set(watches.map((watch) => normalize(watch.query)));
  for (const watch of watches) {
    try {
      if (service.refreshWatch) await service.refreshWatch(watch.id);
      else await service.refresh(watch.query);
    } catch { /* each watch and source is isolated and reported */ }
  }
  const recentQueries = [...new Set((service.lastQueries || []).slice(0, 3))]
    .filter((query) => !watchedQueries.has(normalize(query)))
    .slice(0, Math.max(0, 25 - watches.length));
  for (const query of recentQueries) {
    try { await service.refresh(query); } catch { /* each source is isolated and reported */ }
  }
  try { await service.flushNotifications?.(); } catch { /* durable outbox keeps failed deliveries for the next cycle */ }
}

export function startScheduler(service, intervalMs) {
  if (!Number.isFinite(intervalMs) || intervalMs < 60_000) return () => {};
  const timer = setInterval(() => refreshWatchedQueries(service), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
