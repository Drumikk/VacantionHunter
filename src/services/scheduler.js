export function startScheduler(service, intervalMs) {
  if (!Number.isFinite(intervalMs) || intervalMs < 60_000) return () => {};
  const timer = setInterval(async () => {
    for (const query of service.lastQueries.slice(0, 3)) {
      try { await service.refresh(query); } catch { /* each source is isolated and reported */ }
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
