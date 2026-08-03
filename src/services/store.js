import fs from "node:fs/promises";
import path from "node:path";
import { deduplicateJobs } from "../core/dedupe.js";

export class JobStore {
  #jobs = [];
  #mergeQueue = Promise.resolve();
  constructor(filePath) { this.filePath = filePath; }
  get jobs() { return this.#jobs; }

  async load() {
    try {
      const loaded = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.#jobs = loaded.map((job) => {
        const provenanceKeys = job.provenanceKeys || [`${job.source?.id || "unknown"}:${job.externalId || job.id}`];
        return { ...job, provenanceKeys, duplicateCount: provenanceKeys.length };
      });
    }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    return this.#jobs;
  }

  async merge(jobs) {
    const operation = this.#mergeQueue.then(async () => {
      this.#jobs = deduplicateJobs([...this.#jobs, ...jobs]);
      await this.save();
      return this.#jobs;
    });
    // Keep the queue usable after a failed write while still rejecting this caller.
    this.#mergeQueue = operation.catch(() => {});
    return operation;
  }

  async applySourceChanges(sourceId, jobs, { changedExternalIds = [] } = {}) {
    const operation = this.#mergeQueue.then(async () => {
      const affectedKeys = new Set([
        ...changedExternalIds.map((externalId) => `${sourceId}:${externalId}`),
        ...jobs.filter((job) => job.externalId != null).map((job) => `${sourceId}:${job.externalId}`),
      ]);
      this.#jobs = this.#jobs.filter((job) => {
        const provenanceKeys = job.provenanceKeys || [`${job.source?.id || "unknown"}:${job.externalId || job.id}`];
        return !provenanceKeys.some((key) => affectedKeys.has(key));
      });
      this.#jobs = deduplicateJobs([...this.#jobs, ...jobs]);
      await this.save();
      return this.#jobs;
    });
    this.#mergeQueue = operation.catch(() => {});
    return operation;
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.#jobs, null, 2), "utf8");
    await fs.rename(tmp, this.filePath);
  }
}
