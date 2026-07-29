import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function clone(entry) {
  return { ...entry, payload: { ...entry.payload } };
}

export class NotificationOutbox {
  #entries = [];
  #writeQueue = Promise.resolve();

  constructor(filePath, { maxEntries = 500 } = {}) {
    this.filePath = filePath;
    this.maxEntries = maxEntries;
  }

  get entries() { return this.#entries.map(clone); }

  async load() {
    try {
      const loaded = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.#entries = Array.isArray(loaded) ? loaded.filter((entry) => entry?.id && entry?.dedupeKey && entry?.payload?.text).map((entry) => ({
        ...entry,
        status: ["pending", "sent", "failed"].includes(entry.status) ? entry.status : "pending",
        attempts: Number(entry.attempts || 0),
        nextAttemptAt: entry.nextAttemptAt || entry.createdAt || new Date().toISOString(),
      })) : [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return this.entries;
  }

  async enqueue({ channel, dedupeKey, payload }) {
    const existing = this.#entries.find((entry) => entry.dedupeKey === dedupeKey);
    if (existing) return clone(existing);
    const now = new Date().toISOString();
    const entry = {
      id: crypto.randomUUID(),
      channel,
      dedupeKey,
      payload: { ...payload },
      status: "pending",
      attempts: 0,
      createdAt: now,
      nextAttemptAt: now,
      sentAt: null,
      externalId: null,
      lastError: null,
    };
    this.#entries.push(entry);
    this.#prune();
    await this.save();
    return clone(entry);
  }

  pending({ now = Date.now(), limit = 10 } = {}) {
    return this.#entries
      .filter((entry) => entry.status === "pending" && Date.parse(entry.nextAttemptAt || 0) <= now)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .slice(0, limit)
      .map(clone);
  }

  async markSent(id, externalId = null) {
    const entry = this.#entries.find((item) => item.id === id);
    if (!entry) return null;
    Object.assign(entry, {
      status: "sent",
      sentAt: new Date().toISOString(),
      externalId: externalId == null ? null : String(externalId),
      lastError: null,
    });
    this.#prune();
    await this.save();
    return clone(entry);
  }

  async markFailed(id, error, { delayMs, maxAttempts } = {}) {
    const entry = this.#entries.find((item) => item.id === id);
    if (!entry) return null;
    entry.attempts += 1;
    entry.lastError = String(error?.message || error || "Unknown delivery error").slice(0, 500);
    entry.status = entry.attempts >= maxAttempts ? "failed" : "pending";
    entry.nextAttemptAt = new Date(Date.now() + Math.max(0, delayMs || 0)).toISOString();
    await this.save();
    return clone(entry);
  }

  async retryFailed() {
    let changed = 0;
    const now = new Date().toISOString();
    for (const entry of this.#entries) {
      if (entry.status !== "failed") continue;
      Object.assign(entry, { status: "pending", attempts: 0, nextAttemptAt: now });
      changed += 1;
    }
    if (changed) await this.save();
    return changed;
  }

  stats() {
    const byStatus = (status) => this.#entries.filter((entry) => entry.status === status);
    const sent = byStatus("sent");
    const failed = byStatus("failed");
    return {
      pending: byStatus("pending").length,
      sent: sent.length,
      failed: failed.length,
      lastSentAt: sent.map((entry) => entry.sentAt).filter(Boolean).sort().at(-1) || null,
      lastError: [...this.#entries].reverse().find((entry) => entry.lastError)?.lastError || null,
    };
  }

  #prune() {
    if (this.#entries.length <= this.maxEntries) return;
    const active = this.#entries.filter((entry) => entry.status !== "sent");
    if (active.length >= this.maxEntries) {
      this.#entries = active;
      return;
    }
    const sent = this.#entries.filter((entry) => entry.status === "sent").slice(-(this.maxEntries - active.length));
    this.#entries = [...active, ...sent];
  }

  async save() {
    const snapshot = this.#entries.map(clone);
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
