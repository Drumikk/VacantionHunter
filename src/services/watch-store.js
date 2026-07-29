import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function queryKey(query) {
  return String(query || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

function uniqueIds(values, limit) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value))].slice(0, limit);
}

function cloneWatch(watch) {
  return { ...watch, knownJobIds: [...watch.knownJobIds], unreadJobIds: [...watch.unreadJobIds] };
}

function missingWatch() {
  const error = new Error("Наблюдение не найдено");
  error.statusCode = 404;
  return error;
}

export class WatchStore {
  #watches = [];
  #writeQueue = Promise.resolve();

  constructor(filePath, { maxWatches = 25 } = {}) {
    this.filePath = filePath;
    this.maxWatches = maxWatches;
  }

  get watches() { return this.#watches.map(cloneWatch); }

  get(id) {
    const watch = this.#watches.find((item) => item.id === id);
    return watch ? cloneWatch(watch) : null;
  }

  async load() {
    try {
      const loaded = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.#watches = Array.isArray(loaded) ? loaded.filter((watch) => watch?.id && watch?.query).map((watch) => ({
        ...watch,
        knownJobIds: uniqueIds(watch.knownJobIds, 2_000),
        unreadJobIds: uniqueIds(watch.unreadJobIds, 250),
      })) : [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return this.watches;
  }

  async add(query, { knownJobIds = [] } = {}) {
    const normalizedQuery = String(query || "").trim().replace(/\s+/g, " ");
    if (!normalizedQuery) {
      const error = new Error("Введите поисковый запрос");
      error.statusCode = 400;
      throw error;
    }

    const existing = this.#watches.find((watch) => queryKey(watch.query) === queryKey(normalizedQuery));
    if (existing) return cloneWatch(existing);
    if (this.#watches.length >= this.maxWatches) {
      const error = new Error(`Можно сохранить не более ${this.maxWatches} поисков`);
      error.statusCode = 409;
      throw error;
    }

    const watch = {
      id: crypto.randomUUID(),
      query: normalizedQuery,
      createdAt: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString(),
      lastViewedAt: new Date().toISOString(),
      knownJobIds: uniqueIds(knownJobIds, 2_000),
      unreadJobIds: [],
    };
    this.#watches = [watch, ...this.#watches];
    await this.save();
    return cloneWatch(watch);
  }

  async recordResults(id, resultIds) {
    const watch = this.#watches.find((item) => item.id === id);
    if (!watch) throw missingWatch();
    const currentIds = uniqueIds(resultIds, 250);
    const known = new Set(watch.knownJobIds);
    const newJobIds = currentIds.filter((jobId) => !known.has(jobId));
    watch.knownJobIds = uniqueIds([...currentIds, ...watch.knownJobIds], 2_000);
    watch.unreadJobIds = uniqueIds([...newJobIds, ...watch.unreadJobIds], 250);
    watch.lastCheckedAt = new Date().toISOString();
    await this.save();
    return { watch: cloneWatch(watch), newJobIds };
  }

  async acknowledge(id) {
    const watch = this.#watches.find((item) => item.id === id);
    if (!watch) throw missingWatch();
    watch.unreadJobIds = [];
    watch.lastViewedAt = new Date().toISOString();
    await this.save();
    return cloneWatch(watch);
  }

  async remove(id) {
    const before = this.#watches.length;
    this.#watches = this.#watches.filter((watch) => watch.id !== id);
    if (this.#watches.length === before) return false;
    await this.save();
    return true;
  }

  async save() {
    const snapshot = this.#watches.map(cloneWatch);
    const operation = this.#writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
      await fs.rename(tmp, this.filePath);
    });
    this.#writeQueue = operation.catch(() => {});
    return operation;
  }
}
