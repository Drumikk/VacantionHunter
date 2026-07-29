function restrictedSource({ id, name, attributionUrl, setupUrl, note }) {
  const disabledReason = `Требуется официальный партнёрский доступ: ${setupUrl}`;
  return {
    id,
    name,
    attributionUrl,
    setupUrl,
    note,
    adapter: "partner-only",
    authType: "partner",
    credentialFields: [],
    officialApi: true,
    enabled: false,
    disabledReason,
    async search() { throw new Error(disabledReason); },
  };
}

export function restrictedConnectors() {
  return [
    restrictedSource({
      id: "linkedin",
      name: "LinkedIn Jobs",
      attributionUrl: "https://www.linkedin.com/jobs/",
      setupUrl: "https://learn.microsoft.com/linkedin/talent/job-postings/api/overview",
      note: "Автоматизированный сбор без отдельного разрешения запрещён; подключается только официальный Job Posting/partner feed.",
    }),
    restrictedSource({
      id: "indeed",
      name: "Indeed",
      attributionUrl: "https://www.indeed.com/",
      setupUrl: "https://docs.indeed.com/",
      note: "Публичного API поисковой выдачи нет; для получения вакансий нужен одобренный партнёрский feed/API.",
    }),
  ];
}
