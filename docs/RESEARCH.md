# Доказательная база решений

Дата первоначальной проверки: 2026-07-29. Каталог и новые источники повторно проверены 2026-07-31. Для технических решений использованы первичные документы владельцев API и стандартов.

| Решение | Первичный источник | Что подтверждает | Реализация |
|---|---|---|---|
| HH через JSON API | <https://api.hh.ru/openapi/redoc> | HTTPS/JSON, обязательный User-Agent, OAuth-токен зарегистрированного приложения, поиск по тексту, зарплате, валюте, дате; employer `trusted`, `archived`, `closed_for_applicants` | `src/connectors/hh.js` |
| HH через email-уведомления | <https://feedback.hh.ru/knowledge-base/article/3711> | Сохранённые автопоиски HH отправляют новые вакансии по email; IMAP позволяет автоматизированно импортировать эти уведомления без обхода login/CAPTCHA | `src/connectors/hh-email.js` |
| Greenhouse public Job Board API | <https://developer.greenhouse.io/job-board.html> | Публичное получение опубликованных jobs; application POST требует auth | `src/connectors/greenhouse.js` |
| Lever public Postings API | <https://hire.lever.co/developer/support> | Postings API публично отдаёт опубликованные вакансии | `src/connectors/lever.js` |
| Ashby public Job Postings API | <https://developers.ashbyhq.com/docs/public-job-posting-api> | Список опубликованных вакансий и `includeCompensation=true` | `src/connectors/ashby.js` |
| Recruitee Careers Site API | <https://docs.recruitee.com/reference/intro-to-careers-site-api> | Публичный список опубликованных offers не требует авторизации и использует subdomain компании | `src/connectors/recruitee.js` |
| Workable public careers API | <https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API-to-create-a-careers-page> | Workable документирует публичный account endpoint для опубликованных jobs с `details=true`; API-токен нужен только для private SPI | `src/connectors/workable.js` |
| Personio open positions feed | <https://developer.personio.de/docs/retrieving-open-job-positions> | Официальный XML feed `https://{account}.jobs.personio.de/xml` отдаёт текущие открытые вакансии, описания и структурированные поля | `src/connectors/personio.js` |
| SmartRecruiters Posting API | <https://developers.smartrecruiters.com/docs/endpoints> | Поиск активных postings компании по `q`, пагинация, detail endpoint, опубликованный текст и прямые posting/apply URLs | `src/connectors/smartrecruiters.js` |
| Remotive public API | <https://remotive.com/remote-jobs/api> | Разрешена републикация с атрибуцией; public jobs задержаны на 24 часа | `src/connectors/remotive.js` |
| Arbeitnow API | <https://www.arbeitnow.com/blog/job-board-api> | No-key API, ATS-derived jobs, remote и visa sponsorship поля | `src/connectors/arbeitnow.js` |
| Jooble REST API | <https://help.jooble.org/en/support/solutions/articles/60001448238-rest-api-documentation> | API key, POST search, keywords/location/pagination и поле исходного `source`; международное покрытие без РФ | `src/connectors/jooble.js` |
| USAJOBS Search API | <https://developer.usajobs.gov/api-reference/get-api-search> | API key + email headers, keyword/location/remote/date filters, salary и application close date | `src/connectors/usajobs.js` |
| «Работа России» | <https://trudvsem.ru/opendata/api> | Официальный открытый JSON API Роструда: текстовый поиск, пагинация и инкрементальные изменения | `src/connectors/trudvsem.js` |
| Arbetsförmedlingen JobSearch | <https://jobsearch.api.jobtechdev.se/> | Открытый API государственной службы занятости Швеции с поиском и структурированными полями вакансии | `src/connectors/jobtech.js` |
| Remote OK API | <https://remoteok.com/api> | Публичный JSON feed; при показе данных обязательны атрибуция и ссылка на оригинал | `src/connectors/remoteok.js` |
| We Work Remotely RSS | <https://weworkremotely.com/remote-job-rss-feed> | Официальный публичный RSS; требуется атрибуция и ссылка на оригинальную вакансию | `src/connectors/weworkremotely.js` |
| HN Algolia Search API | <https://hn.algolia.com/api> | Публичный поиск по HN; позволяет получать комментарии ежемесячной темы Who Is Hiring | `src/connectors/hn-who-is-hiring.js` |
| ReliefWeb API v2 | <https://apidoc.reliefweb.int/> | Официальный API OCHA; `appname` обязателен и с 2025-11-01 требует предварительного одобрения | `src/connectors/reliefweb.js` |
| Adzuna Search API | <https://developer.adzuna.com/docs/search> | Country endpoint, keyword/location filters, зарплата, компания и обязательный `redirect_url`; нужны `app_id` + `app_key` | `src/connectors/adzuna.js` |
| Himalayas public API | <https://himalayas.app/api> | Публичный JSON search без авторизации, фильтры remote/географии/стажа и обязательная обратная ссылка | `src/connectors/himalayas.js` |
| Jobicy Remote Jobs API | <https://github.com/Jobicy/remote-jobs-api> | Публичный JSON API без ключа; до 100 записей, шестичасовая задержка, атрибуция и опрос не чаще раза в час | `src/connectors/jobicy.js` |
| Reed Jobseeker API | <https://www.reed.co.uk/developers/jobseeker> | Search endpoint, до 100 результатов и Basic Auth с API key как username | `src/connectors/reed.js` |
| SuperJob API | <https://api.superjob.ru/> | Публичный поиск вакансий через `/2.0/vacancies/`; Secret key приложения в `X-Api-App-Id`, пользовательский OAuth не обязателен | `src/connectors/superjob.js` |
| France Travail API Offres d'emploi | <https://www.data.gouv.fr/dataservices/api-offres-demploi> | Официальные активные вакансии France Travail и согласившихся партнёров, search/detail/references, OAuth-приложение и лимит 10 запросов/с | `src/connectors/france-travail.js` |
| The Muse Jobs API | <https://www.themuse.com/developers/api/v2> | Публичный JSON endpoint вакансий, фильтры по категории/уровню/локации; анонимная квота 500 запросов/ч и 3600 запросов/ч с API key | `src/connectors/the-muse.js` |
| Telegram Bot API | <https://core.telegram.org/bots/api> | HTTPS JSON, `sendMessage` до 4096 символов, `getUpdates`, flood-control `retry_after` | `src/services/notification-service.js` |
| Telegram BotFather | <https://core.telegram.org/bots/features#botfather> | `/newbot` создаёт бота и выдаёт секретный authentication token | `.env` + центр уведомлений |
| LinkedIn automation limits | <https://www.linkedin.com/legal/user-agreement> | scraping, bots и копирование cookies запрещены без отдельного разрешения | policy: connector disabled without partnership |
| Indeed Partner APIs | <https://docs.indeed.com/api-guides/> | текущие API ориентированы на employer/job posting/candidate sync, не публичную выгрузку search results | policy: connector disabled without partnership |
| Актуальность JobPosting | <https://developers.google.com/search/docs/appearance/structured-data/job-posting> | `datePosted`, `validThrough`, полный текст, способ отклика; запрет expired/fake/pay-to-apply | `src/core/authenticity.js` |
| Robots Exclusion Protocol | <https://www.rfc-editor.org/rfc/rfc9309> | Стандартизированный robots.txt для HTML crawler | production policy |
| Hybrid retrieval | <https://www.elastic.co/docs/solutions/search/hybrid-search> | lexical + vector search, рекомендация RRF | production roadmap |
| RRF формула | <https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion> | Fusion по рангам без общей шкалы scores | production roadmap |
| Multi-stage ranking | <https://www.elastic.co/docs/solutions/search/ranking> | дешёвый initial retrieval и более дорогой reranking на малом candidate set | production roadmap |

## Операционная проверка API 2026-07-29

- HH вернул `bad_user_agent` для фиктивного домена в контактном адресе, а credentialed CI с одним `HH_USER_AGENT` получил `403 forbidden`. Поэтому production-коннектор требует реальный `HH_USER_AGENT` и OAuth-авторизацию приложения; анонимный CAPTCHA/403 не обходится.
- 30 июля 2026 года форма HH показала только сценарии для сотрудников одного или нескольких работодателей и уведомление о прекращении поддержки API для соискателей с 15 декабря 2025 года. Прямой коннектор сохраняется только для ранее одобренных токенов.
- Jooble-аудит просканировал глобальный endpoint и `ru.jooble.org`: глобальная русская выдача вернула 0, региональный endpoint отклонил глобальный ключ с 401, а сам российский сайт сообщает о прекращении работы в РФ. Вакансии hh.ru через Jooble не заявляются.
- Remotive JSON API и документированный RSS (`https://remotive.com/feed`) с текущего тестового IP вернули Cloudflare 403. Это инфраструктурная блокировка, а не доказательство закрытия API; коннектор переводится в cooldown, атрибуция и обратная ссылка остаются обязательными.
- Arbeitnow по-прежнему документирует no-key API и обновил страницу 9 марта 2026 г., но текущий тестовый IP получает managed Cloudflare challenge. Обход не применяется; используются cooldown, другой разрешённый deployment egress или договорной API.

Такая проверка намеренно различает «API существует по документации» и «API доступен из конкретного окружения сейчас».

Точечная проверка новых коннекторов 2026-07-31: «Работа России» вернула 16 .NET-вакансий, JobTech — 20 записей и 9 релевантных частичных совпадений, HN Who Is Hiring — 3 полных совпадения. Все 6 Recruitee boards ответили успешно за 93–232 мс. Remote OK, We Work Remotely, Himalayas и Jobicy не завершили TLS/HTTP-запрос из локального Windows egress за отведённый таймаут; их схемы проверены unit-тестами, а сбой изолируется системой health/cooldown. ReliefWeb штатно остаётся `disabled` до одобрения `RELIEFWEB_APPNAME`; Adzuna — до `ADZUNA_APP_ID` и `ADZUNA_API_KEY`; Reed и SuperJob — до своих серверных ключей.

31 июля 2026 года официальный публичный endpoint Workable проверен на 19 company accounts из Европы, Северной и Латинской Америки: каждый выбранный account вернул HTTP 200 и структурированный массив опубликованных jobs. Personio XML feed подтверждён на 10 актуальных career subdomains; три полностью загрузились из локального egress, а `personio:iits` прошёл штатный smoke за 238 мс. SmartRecruiters career pages десяти компаний доступны, но API с локального IP вернул классифицированный Cloudflare 403; обход не применяется, коннекторы уходят в cooldown и могут быть независимо перепроверены из CI/deployment egress. France Travail подтверждён официальным каталогом data.gouv.fr как API активных вакансий для частных разработчиков, компаний, стартапов и территориальных организаций; коннектор остаётся `disabled` до выдачи OAuth client credentials. The Muse подтвердил HTTP 200 и текущую JSON-схему с описанием, компанией, локациями, категорией, уровнем и первичной ссылкой; реализован часовой кэш и необязательный API key. EURES подтверждён как общеевропейский портал, но открытого search API для произвольного приложения в первичной документации не найдено; внутренние endpoints не используются. Canada Job Bank публикует официальные ежемесячные CSV через Open Government Portal, но набор не содержит работодателя, текста вакансии, posting ID и прямого URL отклика, поэтому не подключается как live-коннектор вакансий.

Стартовый пакет из 16 company boards проверен прямыми запросами к публичным API 2026-07-29 и хранится в `config/sources.json`; каждая доска обновляется и наблюдается независимо:

- Ashby: Sola, Qdrant, Enode, Percona, Reedsy, Granular Energy — все вернули `apiVersion=1`, опубликованные вакансии и прямые `jobUrl`;
- Greenhouse: Canonical, Grafana Labs, Elastic, GitLab, Cloudflare — от 131 до 302 опубликованных вакансий на момент проверки;
- Lever: SwissBorg, Zartis, Aircall, PayU GPO, Match Group — от 4 до 83 опубликованных вакансий на момент проверки.

Точный запрос `.NET Разработчик с заработной платой от 4000$ в месяц, удалённо с релокацией` проверен через общий parser → connector → normalization → ranking контур. Ashby/Sola вернул действующую вакансию `Software Engineer, Windows AI Automation`: remote, relocation support, USD 160–300k/year, 100% обязательных условий. Пять Lever boards завершили полный индексный проход; частичные таймауты отдельных detail pages записываются в diagnostics и не маскируются как падение всей доски. Полная воспроизводимая матрица находится в `docs/LIVE_SOURCES.md`.

## Географический scope

Подключаются РФ/СНГ, Европа, Северная и Латинская Америка, Австралия/Новая Зеландия и глобальные remote/ATS-источники. Отдельные локальные джоб-борды Азии, Ближнего Востока и Африки не входят в scope. Глобальный источник не исключается только потому, что содержит вакансии во всём мире: география конкретной вакансии остаётся фильтром запроса.

## Почему не «парсить всё подряд»

HTML нестабилен, дороже в поддержке и часто ограничен условиями использования. ATS API сразу дают нормализуемые поля и первичный URL работодателя. Поэтому список из сотен сайтов — это каталог потенциальных каналов, но не разрешение автоматически обходить их защиту.

Для источника с логином или ключом варианты только такие:

1. официальный OAuth/API key;
2. партнёрский feed или лицензия;
3. публичная страница работодателя/ATS, если правила это разрешают;
4. источник отключается.

CAPTCHA, закрытая авторизация, paywall и технические ограничения не обходятся. Это снижает юридический риск, вероятность блокировок и операционную стоимость.

## Проверяемые тест-кейсы MVP

| Кейс | Ожидаемый инвариант | Тест |
|---|---|---|
| `.NET разработчик удалённо от 4000$` | извлечены role, skill, remote, USD/month minimum | `tests/query-parser.test.js` |
| .NET $8k, .NET $6k, .NET без вилки, Java $10k | $8k → $6k; вакансия без вилки ниже; Java не выигрывает одной зарплатой | `tests/ranker.test.js` |
| Одна вакансия с двух досок | одна карточка, две provenance-ссылки | `tests/dedupe.test.js` |
| Истёкший `validThrough` и просьба оплатить | status stale/suspicious и два risk-сигнала | `tests/authenticity.test.js` |
| Cloudflare 403 и повторный refresh | ошибка классифицирована; повторный запрос пропущен до конца cooldown | `tests/source-resilience.test.js` |

Следующий обязательный набор перед production — 100–300 реальных запросов и 30–100 кандидатов на каждый, оценённых людьми по шкале 0–3. На нём сравниваются deterministic baseline, BM25, hybrid RRF и reranker по nDCG@10/Recall@50.
