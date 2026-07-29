import fs from "node:fs/promises";
import path from "node:path";

export const APPLICATION_STATUSES = Object.freeze([
  "saved",
  "applied",
  "screening",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
]);

const STATUS_SET = new Set(APPLICATION_STATUSES);

function clone(value) {
  return structuredClone(value);
}

function applicationError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeNextAction(value) {
  if (value == null || value === "") return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw applicationError("Некорректная дата следующего действия");
  return new Date(timestamp).toISOString();
}

function normalizeNotes(value) {
  const notes = String(value || "").trim();
  if (notes.length > 4_000) throw applicationError("Заметка не может быть длиннее 4000 символов");
  return notes;
}

function normalizeStatus(value, fallback = "saved") {
  const status = value || fallback;
  if (!STATUS_SET.has(status)) throw applicationError(`Неизвестный статус отклика: ${status}`);
  return status;
}

export function jobSnapshot(job) {
  if (!job?.id || !job?.title || !job?.url) throw applicationError("Вакансия не содержит обязательных полей");
  return clone({
    id: String(job.id),
    externalId: job.externalId == null ? null : String(job.externalId),
    title: job.title,
    company: job.company || "Не указана",
    companyVerified: Boolean(job.companyVerified),
    description: job.description || "",
    url: job.url,
    applyUrl: job.applyUrl || job.url,
    location: job.location || "",
    remote: Boolean(job.remote),
    skills: Array.isArray(job.skills) ? job.skills.slice(0, 30) : [],
    salary: job.salary || null,
    salaryMonthlyUsd: job.salaryMonthlyUsd ?? null,
    postedAt: job.postedAt || null,
    source: job.source ? { id: job.source.id, name: job.source.name, attributionUrl: job.source.attributionUrl || null } : null,
    verification: job.verification || null,
  });
}

export class ApplicationStore {
  #items = [];
  #writeQueue = Promise.resolve();

  constructor(filePath, { maxApplications = 500 } = {}) {
    this.filePath = filePath;
    this.maxApplications = maxApplications;
  }

  get items() { return this.#items.map(clone); }

  list({ status = null } = {}) {
    const wantedStatus = status ? normalizeStatus(status) : null;
    return this.#items
      .filter((item) => !wantedStatus || item.status === wantedStatus)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map(clone);
  }

  get(jobId) {
    const item = this.#items.find((application) => application.jobId === jobId);
    return item ? clone(item) : null;
  }

  async load() {
    try {
      const loaded = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.#items = Array.isArray(loaded) ? loaded.filter((item) => item?.jobId && item?.job?.title && item?.job?.url).map((item) => ({
        ...item,
        status: normalizeStatus(item.status),
        notes: normalizeNotes(item.notes),
        nextActionAt: normalizeNextAction(item.nextActionAt),
        history: Array.isArray(item.history) ? item.history.filter((event) => STATUS_SET.has(event?.status) && event?.at).slice(-100) : [],
      })) : [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return this.items;
  }

  async add(job, options = {}) {
    const snapshot = jobSnapshot(job);
    const existing = this.#items.find((item) => item.jobId === snapshot.id);
    if (existing) return this.update(snapshot.id, { ...options, job: snapshot });
    if (this.#items.length >= this.maxApplications) throw applicationError(`Можно отслеживать не более ${this.maxApplications} вакансий`, 409);
    const { status = "saved", notes = "", nextActionAt = null } = options;
    const now = new Date().toISOString();
    const normalizedStatus = normalizeStatus(status);
    const item = {
      jobId: snapshot.id,
      job: snapshot,
      status: normalizedStatus,
      notes: normalizeNotes(notes),
      nextActionAt: normalizeNextAction(nextActionAt),
      createdAt: now,
      updatedAt: now,
      statusChangedAt: now,
      history: [{ status: normalizedStatus, at: now }],
    };
    this.#items.unshift(item);
    await this.save();
    return clone(item);
  }

  async update(jobId, patch = {}) {
    const item = this.#items.find((application) => application.jobId === jobId);
    if (!item) throw applicationError("Вакансия не найдена в воронке", 404);
    const now = new Date().toISOString();
    if (patch.status !== undefined) {
      const status = normalizeStatus(patch.status, item.status);
      if (status !== item.status) {
        item.status = status;
        item.statusChangedAt = now;
        item.history = [...item.history, { status, at: now }].slice(-100);
      }
    }
    if (patch.notes !== undefined) item.notes = normalizeNotes(patch.notes);
    if (patch.nextActionAt !== undefined) item.nextActionAt = normalizeNextAction(patch.nextActionAt);
    if (patch.job !== undefined) item.job = { ...item.job, ...jobSnapshot(patch.job) };
    item.updatedAt = now;
    await this.save();
    return clone(item);
  }

  async remove(jobId) {
    const before = this.#items.length;
    this.#items = this.#items.filter((item) => item.jobId !== jobId);
    if (this.#items.length === before) return false;
    await this.save();
    return true;
  }

  summary() {
    const counts = Object.fromEntries(APPLICATION_STATUSES.map((status) => [status, 0]));
    this.#items.forEach((item) => { counts[item.status] += 1; });
    return {
      total: this.#items.length,
      active: this.#items.filter((item) => !["rejected", "withdrawn"].includes(item.status)).length,
      counts,
    };
  }

  async save() {
    const snapshot = this.#items.map(clone);
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
