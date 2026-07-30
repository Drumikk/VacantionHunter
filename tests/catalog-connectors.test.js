import assert from "node:assert/strict";
import test from "node:test";
import { trudvsemConnector } from "../src/connectors/trudvsem.js";
import { jobtechConnector } from "../src/connectors/jobtech.js";
import { remoteOkConnector } from "../src/connectors/remoteok.js";
import { parseWwrFeed, weWorkRemotelyConnector } from "../src/connectors/weworkremotely.js";
import { hnWhoIsHiringConnector } from "../src/connectors/hn-who-is-hiring.js";
import { reliefWebConnector } from "../src/connectors/reliefweb.js";
import { recruiteeConnectors } from "../src/connectors/recruitee.js";
import { adzunaConnectors } from "../src/connectors/adzuna.js";
import { himalayasConnector } from "../src/connectors/himalayas.js";
import { jobicyConnector } from "../src/connectors/jobicy.js";
import { reedConnector } from "../src/connectors/reed.js";
import { superJobConnector } from "../src/connectors/superjob.js";

const query = { raw: ".NET developer remote relocation", role: ".NET developer", skills: [".net"], remote: true, relocation: true, locations: [] };

function config(overrides = {}) {
  return { requestTimeoutMs: 1_000, atsRequestTimeoutMs: 1_000, httpUserAgent: "VacationHunter/test", maxJobsPerSource: 20, maxJobsScannedPerSource: 50, ...overrides };
}

test("Работа России maps official vacancies, salary and Russian mobility signals", async () => {
  let requested;
  const connector = trudvsemConnector(config({
    fetchImpl: async (url) => {
      requested = new URL(url);
      return Response.json({ results: { vacancies: [{ vacancy: {
        id: "ru-1", "job-name": "Разработчик .NET", "creation-date": "2026-07-30", date_modify: "2026-07-30T10:00:00+0300",
        company: { name: "АО Пример" }, requirements: "C# ASP.NET. Удалённый формат работы. Компания оплачивает переезд и предоставляет жилье.",
        duty: "Разработка сервисов", benefit: "Компенсация переезда", schedule: "Полный рабочий день",
        salary_min: 200_000, salary_max: 260_000, currency: "руб.", vac_url: "https://trudvsem.ru/vacancy/card/ru-1",
        region: { name: "Москва" }, addresses: { address: [{ location: "Москва" }] },
      } }] } });
    },
  }));

  const [job] = await connector.search(query);
  assert.equal(requested.searchParams.get("text"), ".net");
  assert.equal(job.id, "trudvsem:ru-1");
  assert.deepEqual(job.salary, { min: 200_000, max: 260_000, currency: "RUB", period: "month" });
  assert.equal(job.remote, true);
  assert.equal(job.relocation, true);
  assert.equal(job.companyVerified, true);
});

test("Swedish JobTech maps official JobSearch fields", async () => {
  const connector = jobtechConnector(config({
    fetchImpl: async (url) => {
      assert.equal(new URL(url).searchParams.get("q"), ".net");
      return Response.json({ hits: [{
        id: "se-1", headline: ".NET Developer", webpage_url: "https://arbetsformedlingen.se/platsbanken/annonser/se-1",
        description: { text: "C# ASP.NET remote role with relocation support" }, employer: { name: "Example AB", workplace: "Example" },
        application_details: { url: "https://example.test/apply" }, workplace_address: { city: "Stockholm", region: "Stockholms län", country: "Sverige" },
        employment_type: { label: "Permanent" }, salary_description: "SEK 60000 per month", publication_date: "2026-07-30T08:00:00",
        application_deadline: "2026-09-01T23:59:59", timestamp: 1_785_400_000_000, removed: false,
      }] });
    },
  }));

  const [job] = await connector.search(query);
  assert.equal(job.id, "jobtech-sweden:se-1");
  assert.equal(job.applyUrl, "https://example.test/apply");
  assert.equal(job.remote, true);
  assert.equal(job.relocation, true);
  assert.equal(job.validThrough, "2026-09-01T23:59:59");
});

test("Remote OK preserves attribution links and filters unrelated jobs", async () => {
  const connector = remoteOkConnector(config({
    fetchImpl: async () => Response.json([
      { legal: "link back" },
      { id: 1, position: "Java Engineer", company: "JVM", description: "Spring", url: "https://remoteok.com/1" },
      { id: 2, position: "Senior .NET Developer", company: "Dot", description: "ASP.NET remote with visa sponsorship", url: "https://remoteok.com/2", apply_url: "https://remoteok.com/2", location: "Worldwide", salary_min: 100_000, salary_max: 140_000, date: "2026-07-30T00:00:00Z", tags: ["c#"] },
    ]),
  }));

  const [job] = await connector.search(query);
  assert.equal(job.id, "remoteok:2");
  assert.equal(job.url, "https://remoteok.com/2");
  assert.equal(job.remote, true);
  assert.deepEqual(job.salary, { min: 100_000, max: 140_000, currency: "USD", period: "year" });
});

test("parses and filters the official We Work Remotely RSS feed", async () => {
  const xml = `<?xml version="1.0"?><rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
    <item><title>Acme: Senior .NET Developer</title><link>https://weworkremotely.com/remote-jobs/acme-dotnet</link><guid>wwr-1</guid><description><![CDATA[ASP.NET Core. Remote worldwide. Relocation assistance provided. $100000 - $130000 per year.]]></description><pubDate>Thu, 30 Jul 2026 10:00:00 GMT</pubDate><category>Programming</category></item>
    <item><title>Other: Java Developer</title><link>https://weworkremotely.com/remote-jobs/java</link><guid>wwr-2</guid><description>Spring</description></item>
  </channel></rss>`;
  const source = { id: "weworkremotely" };
  assert.equal(parseWwrFeed(xml, source).length, 2);
  const connector = weWorkRemotelyConnector(config({ fetchImpl: async () => new Response(xml, { headers: { "content-type": "application/rss+xml" } }) }));
  const [job] = await connector.search(query);
  assert.equal(job.externalId, "wwr-1");
  assert.equal(job.company, "Acme");
  assert.equal(job.relocation, true);
});

test("Hacker News connector searches comments in the latest official hiring thread", async () => {
  const requested = [];
  const connector = hnWhoIsHiringConnector(config({
    fetchImpl: async (url) => {
      requested.push(String(url));
      if (String(url).includes("search_by_date")) return Response.json({ hits: [{ objectID: "thread-1", title: "Ask HN: Who is hiring? (July 2026)" }] });
      return Response.json({ hits: [{ objectID: "comment-1", comment_text: "Acme | Senior .NET Developer | Remote worldwide | ASP.NET Core. We provide visa sponsorship and relocation support. $120000 per year", created_at: "2026-07-01T00:00:00Z" }] });
    },
  }));

  const [job] = await connector.search(query);
  assert.match(requested[1], /story_thread-1/);
  assert.equal(job.company, "Acme");
  assert.equal(job.title, "Senior .NET Developer");
  assert.equal(job.remote, true);
  assert.equal(job.relocation, true);
});

test("ReliefWeb is explicit about appname registration and maps approved API responses", async () => {
  const disabled = reliefWebConnector(config());
  assert.equal(disabled.enabled, false);
  assert.match(disabled.disabledReason, /RELIEFWEB_APPNAME/);

  const secretAppName = "vacationhunter-tests-abc";
  let requested;
  const connector = reliefWebConnector(config({
    reliefwebAppName: secretAppName,
    fetchImpl: async (url) => {
      requested = String(url);
      return Response.json({ data: [{ id: "rw-1", fields: {
        title: ".NET Humanitarian Platform Developer", body: "ASP.NET remote role with relocation support", url: "https://reliefweb.int/job/rw-1",
        source: [{ name: "Example NGO" }], country: [{ name: "Poland" }], "job-type": [{ name: "Job" }],
        date: { created: "2026-07-30T00:00:00Z", changed: "2026-07-30T01:00:00Z" }, "closing-date": "2026-08-30T00:00:00Z",
      } }] });
    },
  }));
  const [job] = await connector.search(query);
  assert.equal(new URL(requested).searchParams.get("appname"), secretAppName);
  assert.equal(JSON.stringify(connector).includes(secretAppName), false);
  assert.equal(job.company, "Example NGO");
  assert.equal(job.validThrough, "2026-08-30T00:00:00Z");
});

test("Recruitee expands company slugs into independent public ATS sources", async () => {
  const [connector] = recruiteeConnectors(config({
    recruiteeBoards: [{ slug: "example", name: "Example BV", regions: ["europe"] }],
    fetchImpl: async (url) => {
      assert.equal(url, "https://example.recruitee.com/api/offers/");
      return Response.json({ offers: [{
        guid: "abc123", slug: "senior-net-developer", title: "Senior .NET Developer", company_name: "Example BV",
        careers_url: "https://example.recruitee.com/o/senior-net-developer", careers_apply_url: "https://example.recruitee.com/o/senior-net-developer/c/new",
        location: "Remote job", on_site: false, published_at: "2026-07-30 10:00:00 UTC", close_at: "2026-09-01 10:00:00 UTC",
        salary: { min: 72_000, max: 96_000, currency: "EUR", period: "year" },
        translations: { en: { title: "Senior .NET Developer", description: "ASP.NET services with remote work", requirements: "C# and relocation support" } },
      }] });
    },
  }));

  const [job] = await connector.search(query);
  assert.equal(connector.id, "recruitee:example");
  assert.equal(job.id, "recruitee:example:abc123");
  assert.equal(job.remote, true);
  assert.equal(job.relocation, true);
  assert.deepEqual(job.salary, { min: 72_000, max: 96_000, currency: "EUR", period: "year" });
});

test("Adzuna creates country sources, requires credentials and preserves redirect attribution", async () => {
  const [disabled] = adzunaConnectors(config({ adzunaCountries: ["gb"] }));
  assert.equal(disabled.enabled, false);
  assert.deepEqual(disabled.credentialFields, ["ADZUNA_APP_ID", "ADZUNA_API_KEY"]);

  const secretId = "test-app-id";
  const secretKey = "test-app-key";
  let requested;
  const [connector] = adzunaConnectors(config({
    adzunaCountries: ["gb"], adzunaAppId: secretId, adzunaApiKey: secretKey,
    fetchImpl: async (url) => {
      requested = new URL(url);
      return Response.json({ results: [{
        id: "ad-1", title: "Senior .NET Developer", description: "ASP.NET remote role with relocation support",
        created: "2026-07-30T00:00:00Z", redirect_url: "https://www.adzuna.co.uk/jobs/land/ad/ad-1",
        company: { display_name: "Example Ltd" }, location: { display_name: "London, UK" },
        salary_min: 80_000, salary_max: 100_000, salary_is_predicted: "0", contract_time: "full_time", contract_type: "permanent",
      }] });
    },
  }));

  const [job] = await connector.search(query);
  assert.equal(requested.pathname, "/v1/api/jobs/gb/search/1");
  assert.equal(requested.searchParams.get("app_id"), secretId);
  assert.equal(requested.searchParams.get("app_key"), secretKey);
  assert.equal(JSON.stringify(connector).includes(secretKey), false);
  assert.equal(job.url, "https://www.adzuna.co.uk/jobs/land/ad/ad-1");
  assert.deepEqual(job.salary, { min: 80_000, max: 100_000, currency: "GBP", period: "year", predicted: false });
});

test("Himalayas maps its public remote search response", async () => {
  const connector = himalayasConnector(config({
    fetchImpl: async (url) => {
      const requested = new URL(url);
      assert.equal(requested.pathname, "/jobs/api/search");
      assert.match(requested.searchParams.get("q"), /\.net/i);
      return Response.json({ jobs: [{
        guid: "him-1", title: "Senior .NET Developer", companyName: "Himalaya Co", description: "ASP.NET remote with relocation support",
        applicationLink: "https://himalayas.app/jobs/him-1", locationRestrictions: ["Europe"], employmentType: "Full Time", seniority: "Senior",
        category: ["Engineering"], parentCategories: ["Software"], minSalary: 90_000, maxSalary: 120_000, currency: "USD", salaryPeriod: "annual",
        pubDate: "2026-07-30T00:00:00Z", expiryDate: "2026-09-01T00:00:00Z",
      }] });
    },
  }));
  const [job] = await connector.search(query);
  assert.equal(job.id, "himalayas:him-1");
  assert.equal(job.remote, true);
  assert.equal(job.relocation, true);
  assert.deepEqual(job.salary, { min: 90_000, max: 120_000, currency: "USD", period: "year" });
});

test("Jobicy maps public API jobs and attribution URL", async () => {
  let calls = 0;
  const connector = jobicyConnector(config({
    fetchImpl: async (url) => {
      calls += 1;
      const requested = new URL(url);
      assert.equal(requested.searchParams.get("count"), "100");
      assert.equal(requested.searchParams.has("tag"), false);
      return Response.json({ jobs: [{
      id: 146259, url: "https://jobicy.com/jobs/146259-net-developer", jobTitle: ".NET Developer", companyName: "INNOCV",
      jobDescription: "ASP.NET 100% remote work with relocation support", jobGeo: "Spain", jobType: ["Full-Time"], jobLevel: "Midweight",
      jobIndustry: ["Software Engineering"], pubDate: "2026-07-14T12:10:06Z", salaryMin: 60_000, salaryMax: 80_000,
      salaryCurrency: "EUR", salaryPeriod: "yearly",
      }] });
    },
  }));
  const [job] = await connector.search(query);
  await connector.search({ ...query, raw: `${query.raw} second saved search` });
  assert.equal(calls, 1, "the public feed must not be polled more than once per hour");
  assert.equal(job.url, "https://jobicy.com/jobs/146259-net-developer");
  assert.equal(job.remote, true);
  assert.equal(job.relocation, true);
  assert.deepEqual(job.salary, { min: 60_000, max: 80_000, currency: "EUR", period: "year" });
});

test("Reed uses API key as Basic username and maps UK search results", async () => {
  assert.equal(reedConnector(config()).enabled, false);
  const secret = "reed-secret";
  let authorization;
  const connector = reedConnector(config({
    reedApiKey: secret,
    fetchImpl: async (_url, options) => {
      authorization = options.headers.Authorization;
      return Response.json({ results: [{
        jobId: 42, jobTitle: "Senior .NET Developer", employerName: "Example Ltd", jobDescription: "ASP.NET remote with relocation support",
        locationName: "London", minimumSalary: 70_000, maximumSalary: 90_000, currency: "GBP", jobType: "Full Time",
        contractType: "Permanent", date: "2026-07-30T00:00:00Z", expirationDate: "2026-09-01T00:00:00Z",
        jobUrl: "https://www.reed.co.uk/jobs/senior-net-developer/42", externalUrl: "https://example.test/apply",
      }] });
    },
  }));
  const [job] = await connector.search(query);
  assert.equal(authorization, `Basic ${Buffer.from(`${secret}:`).toString("base64")}`);
  assert.equal(JSON.stringify(connector).includes(secret), false);
  assert.equal(job.applyUrl, "https://example.test/apply");
  assert.equal(job.remote, true);
});

test("SuperJob requires only app secret for public vacancy search", async () => {
  assert.equal(superJobConnector(config()).enabled, false);
  const secret = "superjob-secret";
  let appHeader;
  const connector = superJobConnector(config({
    superjobSecretKey: secret,
    fetchImpl: async (_url, options) => {
      appHeader = options.headers["X-Api-App-Id"];
      return Response.json({ objects: [{
        id: 77, profession: "Разработчик .NET", firm_name: "ООО Пример", vacancyRichText: "ASP.NET. Удалённая работа, поддержка релокации.",
        town: { title: "Москва" }, place_of_work: { title: "Удалённая работа" }, link: "https://www.superjob.ru/vakansii/77.html",
        payment_from: 200_000, payment_to: 260_000, currency: "rub", date_published: 1_785_427_200, date_pub_to: 1_790_611_200,
        moveable: true, is_archive: false,
      }] });
    },
  }));
  const [job] = await connector.search(query);
  assert.equal(appHeader, secret);
  assert.equal(JSON.stringify(connector).includes(secret), false);
  assert.equal(job.id, "superjob:77");
  assert.equal(job.remote, true);
  assert.equal(job.relocation, true);
  assert.deepEqual(job.salary, { min: 200_000, max: 260_000, currency: "RUB", period: "month" });
});
