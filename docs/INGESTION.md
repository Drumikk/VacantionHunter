# Автоматический сбор вакансий

Дата проверки: 2026-08-04.

## Как обычно устроены агрегаторы вакансий

Надёжный агрегатор не является одним универсальным HTML-парсером. Он использует каскад независимых адаптеров:

1. официальный API или партнёрский агрегатор с API key/OAuth;
2. публичный Job Board API конкретной ATS;
3. документированный RSS/XML/JSON feed;
4. разрешённый HTML-адаптер с robots.txt, rate limit и conditional requests;
5. авторизованный браузер — только если площадка письменно разрешает автоматизацию такого сценария.

Каждый адаптер переводит ответ в единый `Job`, после чего общая система выполняет дедупликацию, проверку происхождения, оценку актуальности, ранжирование и сохранение. Scheduler повторяет запросы автоматически, кэш не допускает повторного списания квоты за одинаковый запрос, общий пул запускает не более `SOURCE_CONCURRENCY` источников одновременно, а circuit breaker ставит источник на паузу при 401/403/429, Cloudflare или временном сбое.

Cookies, пароль и пользовательская сессия не являются заменой API. Например, LinkedIn прямо запрещает scripts/robots для scraping и копирование cookies в своём User Agreement. Официальный LinkedIn Jobs API доступен только одобренным Talent Solutions Partners и предназначен для публикации/управления объявлениями, а не для общедоступного поиска вакансий.

## Выбранная схема VacationHunter

| Слой | Покрытие | Авторизация | Статус |
|---|---|---|---|
| Jooble REST API | Международный агрегатор вакансий из job boards, карьерных страниц и рекрутеров | `JOOBLE_API_KEY` | Реализовано; РФ и hh.ru не покрывает |
| HH email alerts | РФ/СНГ, выдача сохранённых поисков HH | отдельный IMAP-ящик + пароль приложения | Реализовано; импортирует официальные уведомления без скрейпинга сайта |
| HeadHunter API | РФ/СНГ | ранее одобренный OAuth-токен приложения | Реализован адаптер; новый доступ для соискателей закрыт |
| Greenhouse, Ashby, Lever, Recruitee, Workable, Personio, SmartRecruiters | Публичные вакансии конкретных работодателей | пользовательский логин не требуется; SmartRecruiters key необязателен | Реализованы 170 live-проверенных board |
| USAJOBS Search API | Федеральные вакансии США | API key + email в заголовках | Реализовано |
| CareerOneStop Jobs V2 | Агрегированный официальный поиск вакансий по США | User ID + Bearer API token | Реализовано; включается после регистрации доступа |
| Arbeidsplassen/NAV | Большинство публично размещённых вакансий Норвегии, кроме FINN.no | Bearer token NAV; публичный вращающийся token только для экспериментов | Реализован lifecycle-feed: cursor/ETag, active/update/inactive, прямые ссылки и безопасное подтверждение batch |
| Remotive, Arbeitnow | Международные remote-вакансии | публичный API | Реализовано; возможна IP/Cloudflare-пауза |
| Himalayas, Jobicy | Международные remote-вакансии | публичные API без ключей | Реализовано; обязательны атрибуция и оригинальные ссылки, Jobicy кэшируется на час |
| Adzuna API | 16 национальных рынков текущего географического scope | `app_id` + `app_key` | Реализовано; все 16 рынков включаются по умолчанию после настройки ключей |
| Reed Jobseeker API | Великобритания | `REED_API_KEY` через Basic Auth | Реализовано; включается после регистрации ключа |
| SuperJob API | РФ/СНГ | `SUPERJOB_SECRET_KEY` в `X-Api-App-Id` | Реализовано; OAuth пользователя для публичного поиска не нужен |
| France Travail API Offres d'emploi | Франция и вакансии партнёров | OAuth client credentials приложения | Реализовано; включается после выдачи доступа к API |
| The Muse Jobs API | Международные вакансии, особенно Северная Америка и global remote | без ключа; API key необязателен | Реализовано; категории выбираются из запроса, страницы кэшируются на час |
| LinkedIn / Indeed | Крупные закрытые площадки | партнёрский договор | Не скрейпятся; открытого search API для этого сценария нет |

Jooble выбран широким международным слоем: официальный API принимает `keywords`, `location`, radius, salary и pagination и возвращает источник, компанию, ссылку, тип, зарплату и время обновления. Он не используется как замена HH: российский сайт Jooble прекратил работу, глобальный API с российской локацией не возвращает российскую выдачу, а региональный endpoint не принимает глобальный ключ.

USAJOBS добавлен как пример прямого tokenized API: он требует `Authorization-Key` и email в `User-Agent`, поддерживает keyword/location/remote/date filters и возвращает нормализуемую зарплату, срок приёма заявок и прямую apply-ссылку.

CareerOneStop добавляет второй независимый официальный слой США. List Jobs V2 получает до 100 свежих кандидатов, локально оставляет релевантные и только для них загружает detail; запросы к detail ограничены по параллелизму, одинаковый поиск кэшируется, а Bearer token не сериализуется в UI или логах. Явный запрос по неамериканской стране не вызывает этот US-only API.

Arbeidsplassen/NAV подключён как непрерывная государственная лента Норвегии, а не как периодический HTML-скрейпер. Коннектор следует `next_url`, сохраняет `Last-Modified`/ETag, получает подробности только у релевантных активных объявлений и немедленно удаляет `INACTIVE`. Изменения сначала записываются в state как pending batch, затем атомарно применяются к `JobStore` и только после этого подтверждаются: при падении процесса batch будет воспроизведён, поэтому закрытие или обновление не потеряется. Токен в state не сохраняется.

## Получение ключей

Без ключей автоматически работают «Работа России», Arbetsförmedlingen JobTech, Remote OK, официальный RSS We Work Remotely, Hacker News Who Is Hiring, Himalayas, Jobicy, Remotive, Arbeitnow и настроенные публичные ATS-доски, включая Workable и Personio. Их не нужно авторизовывать в браузере. Endpoint The Muse технически может отвечать анонимно, но действующие API Terms требуют зарегистрировать приложение, поэтому для постоянной работы задайте `THE_MUSE_API_KEY`; страницы кэшируются минимум на час. Публичные SmartRecruiters Posting API endpoints работают без авторизации, а `SMARTRECRUITERS_API_KEY` имеет смысл только для владельца собственной организации в SmartRecruiters Credential Manager; локальный Cloudflare challenge не обходится. Для ReliefWeb нужен не секретный токен, а предварительно одобренный `appname`:

```powershell
$env:RELIEFWEB_APPNAME='ваше-одобренное-имя'
```

Adzuna подключается парой `app_id`/`app_key`. Для максимального охвата по умолчанию создаются отдельные источники для всех поддержанных рынков текущего scope: `gb,us,at,au,be,br,ca,ch,de,es,fr,it,mx,nl,nz,pl`. При небольшой квоте список можно сократить через `ADZUNA_COUNTRIES`:

```powershell
$env:ADZUNA_APP_ID='ваш-app-id'
$env:ADZUNA_API_KEY='ваш-app-key'
$env:ADZUNA_COUNTRIES='gb,us,at,au,be,br,ca,ch,de,es,fr,it,mx,nl,nz,pl'
```

Reed выдаёт Jobseeker API key после регистрации разработчика; ключ передаётся как Basic username с пустым паролем. SuperJob требует Secret key зарегистрированного приложения в заголовке `X-Api-App-Id`; пользовательский OAuth для чтения публичных вакансий не используется:

```powershell
$env:REED_API_KEY='ваш-api-key'
$env:SUPERJOB_SECRET_KEY='ваш-secret-key'
npm start
```

France Travail требует создать приложение, запросить доступ к продукту «API Offres d'emploi» и сохранить OAuth client credentials только на сервере:

```powershell
$env:FRANCE_TRAVAIL_CLIENT_ID='ваш-client-id'
$env:FRANCE_TRAVAIL_CLIENT_SECRET='ваш-client-secret'
npm start
```

Для production-доступа к Arbeidsplassen/NAV нужно письменно принять [условия API](https://arbeidsplassen.nav.no/vilkar-api) и отправить на `nav.team.arbeidsplassen@nav.no` идентификатор организации/компании, контактный email, телефон и контактное лицо. Полученный Bearer token сохраняется только на сервере:

```powershell
$env:NAV_API_TOKEN='выданный-production-token'
npm start
```

Для локальной проверки NAV публикует вращающийся experiment token. Приложение может получить его автоматически только после явного включения режима; это не production-настройка:

```powershell
$env:NAV_USE_PUBLIC_TOKEN='true'
$env:NAV_LOOKBACK_DAYS='1'
npm run smoke:live -- --source=nav-norway "sykepleier"
```

### Job Market Finland — официальный lifecycle-feed

1. Подать заявку организации через [инструкцию Job Market Finland](https://tyomarkkinatori.fi/en/instructions-and-support/interfaces/interfaces-for-job-postings). KEHA проверяет Business ID, сначала выдаёт тестовый, затем production-доступ.
2. Выполнить требования KEHA к сетевому доступу и сохранить выданный `KIPA-Subscription-Key` только в локальном `.env`.
3. Указать ключ и перезапустить сервер:

```powershell
$env:JOBMARKET_FINLAND_API_KEY='выданный-subscription-key'
npm run smoke:live -- --source=job-market-finland "software engineer"
```

Первый успешный запрос получает полный NDJSON snapshot объявлений `PUBLISHED`; следующие используют интервалы изменения для `PUBLISHED` и `ARCHIVED`. Batch сначала сохраняется как pending, затем атомарно заменяет/изменяет provenance источника в `JobStore` и только после этого подтверждает cursor. Обязательная атрибуция «Job Market Finland’s customer information system» сохраняется в каждой вакансии. Данные нельзя пересылать третьим сторонам вне разрешённого e-service без отдельного согласования.

### Levels.fyi Jobs — только партнёрский канал

Доска <https://www.levels.fyi/jobs> присутствует в каталоге, но автоматический HTML scraping не включён: [Terms](https://www.levels.fyi/about/terms.html) запрещают scraping/crawlers/data mining. Опубликованный [API access](https://www.levels.fyi/api-access/) относится к compensation data, а не к выдаче вакансий. Коннектор `levels-fyi` останется `partner-only`, пока Levels.fyi письменно не предоставит jobs API/feed и разрешение на этот сценарий.

Текущая карта реализованных и следующих источников: [аудит каталога](SOURCE_CATALOG_AUDIT.md).

### Jooble — рекомендуется первым

1. Открыть <https://jooble.org/api/about>.
2. Заполнить форму: имя, роль, email, сайт приложения и телефон. В качестве сайта MVP можно указать репозиторий проекта: <https://github.com/Drumikk/VacantionHunter>.
3. После одобрения сохранить выданный ключ только в переменной окружения `JOOBLE_API_KEY`.

Для постоянной локальной конфигурации скопируйте `.env.example` в `.env` и впишите ключ туда. Файл исключён из git и загружается сервером автоматически.

```powershell
$env:JOOBLE_API_KEY='полученный-ключ'
npm start
```

Ключ передаётся сервером непосредственно Jooble и никогда не попадает в HTML, `/api/sources`, логи ошибок или git.

## Контроль и диагностика

В интерфейсе нажмите индикатор «Источники» в верхней панели. Центр источников получает безопасный снимок из `GET /api/sources`: статусы, тип авторизации, только имена требуемых переменных окружения, время последнего успеха и причину cooldown. Значения токенов и email не сериализуются.

Кнопка «Проверить сейчас» вызывает `POST /api/sources/:id/check` только для выбранного коннектора. Остальные источники не опрашиваются; результат добавляется в локальное хранилище и сразу становится доступен поиску. Неизвестный ID возвращает 404, демо-источник не допускает ручного сетевого обновления.

Для end-to-end проверки без UI используется `npm run smoke:live -- "<запрос>"`. Smoke-команда не скрывает отключённые источники, измеряет время каждого адаптера, считает полные/частичные совпадения и включает connector diagnostics. Флаг `--source=ashby:sola` проверяет один источник, `--source=lever` — весь тип адаптера, `--strict` возвращает ненулевой exit code при любом `disabled` или `error`. Состояние lifecycle-feed NAV в smoke-команде всегда изолируется во временной папке и удаляется после проверки, поэтому рабочий cursor не сдвигается.

GitHub Actions workflow `live-sources.yml` выполняет точный приёмочный запрос по расписанию каждые 6 часов. Это дополнительный deployment egress и независимая проверка доступности: локальный Cloudflare/IP block не считается доказательством неработоспособности API, а отличие CI от локального результата становится наблюдаемым. Artifact и job summary сохраняются всегда; после этого workflow становится красным, если хотя бы один включённый источник завершился ошибкой. Отключённые до выдачи credentials источники учитываются отдельно и сами по себе job не роняют.

### USAJOBS — дополнительный источник

1. Запросить ключ на <https://developer.usajobs.gov/APIRequest/Index>.
2. Использовать тот же email, который был указан при запросе ключа.

```powershell
$env:USAJOBS_API_KEY='полученный-ключ'
$env:USAJOBS_EMAIL='ваш-email@example.com'
npm start
```

### CareerOneStop — широкий поиск по США

1. Запросить доступ к Web APIs на <https://www.careeronestop.org/Developers/WebAPI/web-api.aspx>.
2. Сохранить выданные User ID и API token только в серверном `.env`.

```powershell
$env:CAREERONESTOP_USER_ID='выданный-user-id'
$env:CAREERONESTOP_API_TOKEN='выданный-api-token'
npm start
```

### HeadHunter через email-уведомления — рабочий вариант для соискателя

1. На HH создайте нужный поиск, сохраните его как автопоиск и включите email-уведомления.
2. Рекомендуется завести отдельный почтовый ящик только для вакансий либо настроить пересылку писем HH в такой ящик.
3. Для Gmail включите двухэтапную аутентификацию и создайте отдельный пароль приложения. Основной пароль аккаунта использовать нельзя.
4. Заполните локальный `.env` (значения не нужно отправлять в чат):

```dotenv
HH_EMAIL_IMAP_HOST=imap.gmail.com
HH_EMAIL_IMAP_PORT=993
HH_EMAIL_IMAP_SECURE=true
HH_EMAIL_IMAP_USER=vacancies@example.com
HH_EMAIL_IMAP_PASSWORD=пароль-приложения
HH_EMAIL_IMAP_FOLDER=INBOX
HH_EMAIL_SENDER_DOMAINS=hh.ru,headhunter.ru
HH_EMAIL_LOOKBACK_DAYS=30
```

После запуска откройте центр «Источники» и нажмите «Проверить сейчас» у `HeadHunter email alerts`. Коннектор принимает только отправителей с точным доменом `hh.ru`, `headhunter.ru` или их поддоменами, извлекает ID и канонические ссылки на вакансии, не исполняет HTML/JavaScript и не вызывает IMAP-команды изменения писем. Последний обработанный UID хранится в `data/hh-email-state.json`, поэтому письмо не импортируется повторно. Планировщик опрашивает источник каждые 15 минут при наличии сохранённого наблюдения или недавнего запроса.

### HeadHunter через ранее одобренный API

```powershell
$env:HH_USER_AGENT='VacationHunter/0.2 (contact: ваш-email@example.com)'
$env:HH_ACCESS_TOKEN='токен зарегистрированного приложения'
```

## Эксплуатационные ограничения

- Секреты задаются только на сервере через environment/secret manager; в `config/sources.json` их быть не должно.
- Одинаковый запрос к tokenized API кэшируется на `AGGREGATOR_CACHE_MS` (по умолчанию 15 минут).
- 401/403 дают длительный cooldown, 429 учитывает `Retry-After`, временные ошибки получают exponential backoff.
- Система не обходит CAPTCHA, Cloudflare, paywall, login wall или ограничения выдачи.
- Для RSS/API всегда сохраняется оригинальная ссылка и требуемая владельцем атрибуция; пользовательские cookies и пароли job boards не собираются.

## Автоматическая доставка результатов

Сохранённый поиск обновляется планировщиком и сравнивается с `knownJobIds`. Для новых ID формируется Telegram-дайджест максимум из `NOTIFICATION_MAX_JOBS` вакансий. Событие сначала кладётся в `data/notification-outbox.json` и получает детерминированный dedupe key из watch ID и набора вакансий; только после этого новые ID фиксируются в durable watch store. Такой порядок не теряет событие при остановке процесса между записями, а повторная постановка схлопывается dedupe key.

Telegram подключается через `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID`. Токен создаётся официальным `@BotFather`; пользователь должен сначала написать боту, поскольку бот не может сам начать личный диалог. Если задан только токен, `POST /api/notifications/discover` читает `getUpdates` и возвращает безопасный список последних chat ID без токена. `POST /api/notifications/test` проверяет готовую конфигурацию.

Доставка использует `sendMessage`, plain text не длиннее 4000 символов и отключённые link previews. Очередь сериализует отправку, сохраняет попытки и `message_id`; для flood control применяется полученный `retry_after`, для остальных ошибок — exponential backoff. После исчерпания попыток запись становится `failed`, а ручная команда «Повторить очередь» возвращает dead-letter записи в доставку. Статус доступен в `GET /api/notifications/status` без значений credentials.
- Adzuna по умолчанию не включён: официальные условия указывают базовые лимиты 25 запросов/минуту и 250/день, обязательную атрибуцию при публикации объявлений и возможную лицензию для длительного использования.

## Первичные документы

- Jooble REST API: <https://help.jooble.org/en/support/solutions/articles/60001448238-rest-api-documentation>
- Jooble API registration: <https://jooble.org/api/about>
- HH: автопоиски и уведомления: <https://feedback.hh.ru/knowledge-base/article/3711>
- Gmail IMAP и пароли приложений: <https://support.google.com/mail/answer/7126229>, <https://support.google.com/accounts/answer/185833>
- Adzuna overview/search/terms: <https://developer.adzuna.com/overview>, <https://developer.adzuna.com/docs/search>, <https://developer.adzuna.com/docs/terms_of_service>
- USAJOBS authentication/search: <https://developer.usajobs.gov/guides/authentication>, <https://developer.usajobs.gov/api-reference/get-api-search>
- CareerOneStop Web APIs / Jobs V2: <https://www.careeronestop.org/Developers/WebAPI/web-api.aspx>, <https://api.careeronestop.org/api-explorer/home/index/JobSearchV2_GetJobsByKeywordAndOnetCode>, <https://api.careeronestop.org/api-explorer/home/index/JobSearchV2_GetJobDetailsbyID>
- Arbeidsplassen/NAV feed, terms and official catalog: <https://navikt.github.io/pam-stilling-feed/>, <https://arbeidsplassen.nav.no/vilkar-api>, <https://data.norge.no/nb/datasets/62409bc8-680d-3f70-98bf-d2f2beebaa50/api-navs-stillingsdatabase>
- «Работа России» Open Data API: <https://trudvsem.ru/opendata/api>
- Arbetsförmedlingen JobSearch API: <https://jobsearch.api.jobtechdev.se/>
- Remote OK API: <https://remoteok.com/api>
- We Work Remotely RSS: <https://weworkremotely.com/remote-job-rss-feed>
- HN Algolia API: <https://hn.algolia.com/api>
- ReliefWeb API v2 и appname: <https://apidoc.reliefweb.int/>, <https://apidoc.reliefweb.int/parameters>
- Recruitee Careers Site API: <https://docs.recruitee.com/reference/intro-to-careers-site-api>, <https://docs.recruitee.com/reference/offers>
- Himalayas public API: <https://himalayas.app/api>
- Jobicy Remote Jobs API: <https://github.com/Jobicy/remote-jobs-api>
- Reed Jobseeker API: <https://www.reed.co.uk/developers/jobseeker>
- SuperJob API: <https://api.superjob.ru/>
- Workable public careers API: <https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API-to-create-a-careers-page>
- Personio open positions XML feed: <https://developer.personio.de/docs/retrieving-open-job-positions>
- SmartRecruiters Posting API: <https://developers.smartrecruiters.com/docs/posting-api>
- France Travail API Offres d'emploi: <https://www.data.gouv.fr/dataservices/api-offres-demploi>
- Job Market Finland onboarding, search API and terms: <https://tyomarkkinatori.fi/en/instructions-and-support/interfaces/interfaces-for-job-postings>, <https://tyomarkkinatori.fi/jobpostingprovider/documentation/KIPA-search-jobpostings-en.html>, <https://tyomarkkinatori.fi/en/instructions-and-support/interfaces/interfaces-for-job-postings/terms-of-use-for-job-market-finlands-job-posting-apis>
- Levels.fyi Jobs, Terms and API access: <https://www.levels.fyi/jobs>, <https://www.levels.fyi/about/terms.html>, <https://www.levels.fyi/api-access/>
- LinkedIn User Agreement: <https://www.linkedin.com/legal/user-agreement>
- LinkedIn partner Jobs API: <https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/create-apply-connect-jobs>
- Indeed Partner API guides: <https://docs.indeed.com/api-guides/>
- Telegram Bot API `sendMessage`, `getUpdates` и `retry_after`: <https://core.telegram.org/bots/api>
- Официальное создание бота через BotFather: <https://core.telegram.org/bots/features#botfather>
