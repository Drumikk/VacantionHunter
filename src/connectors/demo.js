import fs from "node:fs/promises";

export function demoConnector(path) {
  const defaultSource = { id: "demo", name: "Демо", officialApi: true, attributionUrl: "http://localhost" };
  return {
    id: "demo",
    name: "Демонстрационные данные",
    officialApi: true,
    attributionUrl: "http://localhost",
    async search() {
      const jobs = JSON.parse(await fs.readFile(path, "utf8"));
      return jobs.map((job) => ({ ...job, source: job.source || defaultSource, sourceQuality: 0.75 }));
    },
  };
}
