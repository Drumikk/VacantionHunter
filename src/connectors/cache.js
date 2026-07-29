function queryKey(query) {
  return String(query?.raw || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

export function cachedSearch(search, { ttlMs = 15 * 60 * 1_000, maxEntries = 50 } = {}) {
  const cache = new Map();
  return async (query) => {
    const key = queryKey(query);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const pending = Promise.resolve(search(query));
    cache.set(key, { expiresAt: Date.now() + ttlMs, value: pending });
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    try {
      const value = await pending;
      cache.set(key, { expiresAt: Date.now() + ttlMs, value });
      return value;
    } catch (error) {
      cache.delete(key);
      throw error;
    }
  };
}
