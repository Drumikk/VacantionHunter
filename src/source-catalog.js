const TARGET_REGIONS = ["russia-cis", "europe", "north-america", "global-remote"];

const FAMILY_ADAPTER = {
  greenhouseBoards: "greenhouse",
  ashbyBoards: "ashby",
  leverSites: "lever",
  recruiteeBoards: "recruitee",
  workableBoards: "workable",
  personioBoards: "personio",
  smartRecruitersCompanies: "smartrecruiters",
};

const ALL_ATS_FAMILIES = [
  "greenhouseBoards",
  "ashbyBoards",
  "leverSites",
  "recruiteeBoards",
  "workableBoards",
  "personioBoards",
  "smartRecruitersCompanies",
];

export function splitSourceUrls(value = "") {
  return String(value).match(/https?:\/\/[^\s]+/giu) || [];
}

export function normalizeCompanyName(value = "") {
  return String(value).toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

export function isLinkedInUrl(value) {
  try {
    const host = new URL(value).hostname.toLocaleLowerCase("en-US");
    return host === "linkedin.com" || host.endsWith(".linkedin.com");
  } catch {
    return false;
  }
}

function canonicalUrl(value) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|_ga$)/i.test(key)) url.searchParams.delete(key);
  }
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function sourceId(family, slug) {
  return `${FAMILY_ADAPTER[family] || family}:${slug}`;
}

function careerId(value) {
  const normalized = String(value)
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "catalog-source";
}

function atsRoute(value) {
  const url = new URL(value);
  const host = url.hostname.toLocaleLowerCase("en-US");
  if (host.endsWith(".jobs.personio.de")) return { family: "personioBoards", slug: host.slice(0, -".jobs.personio.de".length) };
  const slug = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "");
  if (!slug) return null;

  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    return { family: "greenhouseBoards", slug };
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    return { family: "leverSites", slug, ...(host === "jobs.eu.lever.co" ? { apiBase: "https://api.eu.lever.co" } : {}) };
  }
  if (host === "jobs.ashbyhq.com") return { family: "ashbyBoards", slug };
  if (host === "apply.workable.com") return { family: "workableBoards", slug };
  return null;
}

function existingCoverage(registry) {
  const companies = new Map();
  const slugs = Object.fromEntries(ALL_ATS_FAMILIES.map((family) => [family, new Set()]));
  for (const family of ALL_ATS_FAMILIES) {
    for (const board of Array.isArray(registry[family]) ? registry[family] : []) {
      if (!board?.slug || board.enabled === false) continue;
      slugs[family].add(String(board.slug).toLocaleLowerCase("en-US"));
      const company = normalizeCompanyName(board.name || board.slug);
      if (company && !companies.has(company)) companies.set(company, { family, slug: board.slug });
    }
  }
  return { companies, slugs };
}

function auditEntry(row, disposition, values = {}) {
  return {
    row: row.row,
    rowId: row.rowId,
    company: row.company,
    jobSite: row.jobSite,
    disposition,
    connectorIds: values.connectorIds || [],
    excludedUrls: values.excludedUrls || [],
    supplementalUrls: values.supplementalUrls || [],
  };
}

function supplementalSources(catalog, row) {
  const values = catalog?.research?.supplementalSources?.[String(row.row)];
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => typeof value === "string" ? { url: value } : value)
    .filter((value) => value?.url && value.status !== "inactive");
}

export function expandRussianCompanyCatalog({ registry = {}, catalog = {} } = {}) {
  const additions = {
    greenhouseBoards: [],
    ashbyBoards: [],
    leverSites: [],
    workableBoards: [],
    personioBoards: [],
    careerPages: [],
    audit: [],
  };
  const { companies, slugs } = existingCoverage(registry);
  const seenCareerUrls = new Map();
  const usedCareerIds = new Set();

  for (const row of Array.isArray(catalog.rows) ? catalog.rows : []) {
    if (!row.company) {
      additions.audit.push(auditEntry(row, "metadata-row"));
      continue;
    }

    const supplements = supplementalSources(catalog, row);
    const supplementalUrls = supplements.flatMap((value) => splitSourceUrls(value.url));
    const urls = [...new Set([...splitSourceUrls(row.jobSite), ...supplementalUrls])];
    if (!urls.length) {
      additions.audit.push(auditEntry(row, "no-job-site", { supplementalUrls }));
      continue;
    }

    const excludedUrls = urls.filter(isLinkedInUrl);
    const allowedUrls = urls.filter((url) => !isLinkedInUrl(url));
    if (!allowedUrls.length) {
      additions.audit.push(auditEntry(row, "excluded-linkedin", { excludedUrls, supplementalUrls }));
      continue;
    }

    const covered = companies.get(normalizeCompanyName(row.company));
    if (covered) {
      additions.audit.push(auditEntry(row, "already-covered", {
        connectorIds: [sourceId(covered.family, covered.slug)],
        excludedUrls,
        supplementalUrls,
      }));
      continue;
    }

    const connectorIds = [];
    let ordinal = 0;
    for (const value of allowedUrls) {
      const url = canonicalUrl(value);
      const route = atsRoute(url);
      if (route) {
        const normalizedSlug = route.slug.toLocaleLowerCase("en-US");
        if (!slugs[route.family].has(normalizedSlug)) {
          const board = {
            slug: route.slug,
            name: row.company,
            homepage: url,
            regions: [...TARGET_REGIONS],
            catalogRow: row.row,
            ...(route.apiBase ? { apiBase: route.apiBase } : {}),
          };
          additions[route.family].push(board);
          slugs[route.family].add(normalizedSlug);
        }
        connectorIds.push(sourceId(route.family, route.slug));
        continue;
      }

      const duplicate = seenCareerUrls.get(url);
      if (duplicate) {
        connectorIds.push(`career-page:${duplicate}`);
        continue;
      }

      ordinal += 1;
      const base = careerId(row.company);
      let id = ordinal === 1 ? base : `${base}-${ordinal}`;
      let collision = ordinal;
      while (usedCareerIds.has(id)) {
        collision += 1;
        id = `${base}-${collision}`;
      }
      usedCareerIds.add(id);
      seenCareerUrls.set(url, id);
      additions.careerPages.push({
        id,
        name: row.company,
        url,
        homepage: url,
        regions: [...TARGET_REGIONS],
        catalogRow: row.row,
      });
      connectorIds.push(`career-page:${id}`);
    }

    additions.audit.push(auditEntry(row, "added", { connectorIds: [...new Set(connectorIds)], excludedUrls, supplementalUrls }));
  }

  return additions;
}

export function catalogCoverageSummary(audit = []) {
  const dispositions = {};
  const connectorIds = new Set();
  for (const row of audit) {
    dispositions[row.disposition] = (dispositions[row.disposition] || 0) + 1;
    for (const id of row.connectorIds || []) connectorIds.add(id);
  }
  return { rows: audit.length, dispositions, connectors: connectorIds.size };
}
