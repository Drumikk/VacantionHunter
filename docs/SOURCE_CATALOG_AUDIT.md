# Аудит каталога источников и план максимального покрытия

Дата аудита: 2026-08-04. Исходный каталог: `Ресурсы_поиска_работы_РФ_Европа_Америка_Океания_2026-07-29.xlsx`.

## Что находится в каталоге

В книге 287 ресурсов: 152 приоритета A, 104 приоритета B и 31 приоритета C. Это не 287 взаимозаменяемых API. Каталог объединяет агрегаторы, государственные порталы, remote-доски, фриланс-площадки, карьерные системы работодателей, отраслевые сайты и ресурсы, где автоматический сбор возможен только по партнёрскому соглашению.

По типам источников самые крупные группы: 47 региональных досок, 40 национальных/официальных, 30 remote-only, 27 freelance, 25 отраслевых, 20 глобальных, 20 tech/startup, 19 NGO, 15 агрегаторов, 15 нишевых, 15 академических и 14 relocation-friendly.

## Реальное состояние приложения

После текущего расширения оркестратор знает 210 независимо наблюдаемых источников при стандартной конфигурации: 40 API/RSS/feed/policy-источников плюс 170 конкретных карьерных досок Greenhouse/Ashby/Lever/Recruitee/Workable/Personio/SmartRecruiters. Из них 180 работают без новых credentials, остальные явно показывают требуемую настройку. Каждый источник имеет отдельные health, timeout, retry и cooldown; общее число одновременных опросов ограничено `SOURCE_CONCURRENCY`, поэтому падение или медленный ответ одной компании не останавливает остальные и не создаёт сетевой шторм.

| Слой | Подключено | Доступ | Примечание |
|---|---:|---|---|
| Государственные API/feed | 7 | «Работа России» и JobTech без ключа; USAJOBS, CareerOneStop, France Travail, Arbeidsplassen/NAV и Job Market Finland с credentials | Самые устойчивые и юридически прозрачные данные; NAV и Finland поддерживают обновления и удаления через lifecycle-feed |
| Глобальные/remote API и RSS | 7 | Remotive, Arbeitnow, Remote OK, WWR, HN, Himalayas, Jobicy без пользовательского логина | Атрибуция сохраняется, Jobicy опрашивается не чаще раза в час, HTML login scraping не используется |
| Агрегаторы и региональные API | 20 | Jooble + 16 стран Adzuna + Reed + SuperJob + The Muse | Adzuna, Reed и SuperJob включаются после добавления ключей; The Muse работает анонимно, а необязательный ключ повышает квоту |
| Международные организации | 1 | ReliefWeb с одобренным `appname` | Подключается одной переменной окружения |
| Публичные ATS работодателей | 170 board | Без пользовательского логина | Greenhouse 67, Ashby 39, Lever 12, Recruitee 7, Workable 19, Personio 16, SmartRecruiters 10 |
| Ограниченные платформы | 5 | HH API/email, LinkedIn, Indeed, Levels.fyi Jobs | HH необязателен; LinkedIn/Indeed/Levels.fyi отключены без разрешённого партнёрского канала |

## Что добавлено в этой итерации

| Источник | Канал | Авторизация | Состояние |
|---|---|---|---|
| Работа России | официальный JSON API | нет | реализован, unit + live |
| Arbetsförmedlingen Platsbanken | официальный JobTech API | нет | реализован, unit + live |
| Remote OK | публичный JSON API | нет | реализован, unit; live зависит от egress |
| We Work Remotely | официальный RSS | нет | реализован, unit; live зависит от egress |
| Hacker News Who Is Hiring | HN Algolia API | нет | реализован, unit + live |
| ReliefWeb Jobs | официальный OCHA API v2 | approved `appname` | реализован, до настройки виден как disabled |
| Recruitee | публичный Careers Site API | нет | generic-адаптер + 7 live-проверенных company boards |
| Adzuna | официальный Search API | `app_id` + `app_key` | generic country-адаптер; все 16 рынков scope включены по умолчанию и настраиваются через `ADZUNA_COUNTRIES` |
| Himalayas | официальный публичный Search API | нет | реализован, unit; локальный live-запрос завершился egress timeout |
| Jobicy | официальный публичный JSON API | нет | реализован, unit; общий feed кэшируется на час по требованиям владельца, локальный live-запрос завершился egress timeout |
| Reed.co.uk | официальный Jobseeker API | API key через Basic Auth | реализован; до настройки `REED_API_KEY` виден как disabled |
| SuperJob | официальный API вакансий | Secret key приложения | реализован; до настройки `SUPERJOB_SECRET_KEY` виден как disabled, OAuth пользователя не нужен |
| France Travail | официальный API активных вакансий | OAuth client credentials | реализован; до настройки пары `FRANCE_TRAVAIL_CLIENT_ID`/`FRANCE_TRAVAIL_CLIENT_SECRET` виден как disabled |
| CareerOneStop | официальный Jobs V2 API Министерства труда США | User ID + Bearer API token | реализован; list → локальный prefilter → ограниченный detail, одинаковые запросы кэшируются |
| Arbeidsplassen/NAV | официальный непрерывный feed вакансий Норвегии | production Bearer token NAV; публичный token только для экспериментов | реализован и live-проверен: cursor/ETag, релевантный detail, ACTIVE/INACTIVE, write-ahead replay и удаление закрытых вакансий |
| Job Market Finland | официальный KEHA Job Posting Search API v2, NDJSON | `KIPA-Subscription-Key`, выдаваемый после регистрации организации | реализован и покрыт fixtures/unit: полный PUBLISHED snapshot, затем PUBLISHED/ARCHIVED delta, write-ahead replay и удаление закрытых вакансий; live ждёт ключ и allowlist |
| Levels.fyi Jobs | публичная доска, но без открытого jobs API | только письменное API/feed-разрешение | зарегистрирован как `partner-only`: Terms запрещают автоматический scraping, опубликованный API/MCP относится к compensation data и не подменяется вакансионным API |
| Workable | официальный публичный careers endpoint | нет | generic-адаптер + 19 company boards, каждая live-проверена структурированным JSON |
| The Muse | официальный публичный Jobs API | необязательный API key | реализован: категоризация запроса, 2 страницы на категорию, локальная точная фильтрация и часовой кэш |
| Personio | официальный XML feed карьерной страницы | нет | generic-адаптер + 16 европейских и трансатлантических company boards |
| SmartRecruiters | официальный Posting API | без логина, необязательный server API key | generic-адаптер + 10 компаний; локальный API egress получает Cloudflare 403 и изолируется cooldown |
| ATS expansion 2026-08-04 | публичные endpoints пяти уже поддержанных ATS | нет | +36 непустых live-проверенных boards: Greenhouse 17, Ashby 12, Lever 2, Recruitee 1, Personio 4 |
| ATS expansion II 2026-08-04 | повторная массовая live-проверка официальных ATS endpoints | нет | +73 непустых boards: Greenhouse 45, Ashby 21, Lever 5, Personio 2; один зеркальный ClickHouse feed исключён |

## Как действительно получить максимум

Количество покрываемых сайтов следует увеличивать слоями, а не писать сотни хрупких HTML-парсеров.

1. Один адаптер на ATS-платформу. Greenhouse/Ashby/Lever/Recruitee/Workable/Personio/SmartRecruiters уже дают 170 отдельных источников. Следующие высокоэффективные шаги — дополнительные проверенные slugs существующих адаптеров и только документированные career endpoints новых ATS-семейств. Для каждой компании хранится только slug и метаданные.
2. Официальные государственные API. France Travail и lifecycle-feed Arbeidsplassen/NAV и Job Market Finland уже реализованы. EURES требует одобренного партнёрского канала, а открытая выгрузка Canada Job Bank — это аналитический CSV без ID работодателя и прямых apply URL, поэтому оба источника не маскируются под полноценный live search API.
3. API-ключи агрегаторов. Adzuna, Reed и SuperJob уже имеют готовые адаптеры и подключаются после регистрации; для следующих сервисов сначала проверяются лицензия, квоты и требования к атрибуции.
4. RSS/Atom/JSON feeds. Подключаются общим feed-адаптером с allowlist, лимитом размера, XML-защитой, условными запросами и обязательной ссылкой на источник.
5. Разрешённый HTML. Отдельный адаптер возможен лишь после проверки robots.txt и условий использования; без обхода CAPTCHA, Cloudflare, login wall и rate limits.
6. Партнёрские источники. LinkedIn, Indeed, Levels.fyi Jobs, закрытые freelance-площадки и другие restricted-сайты остаются отключёнными, пока нет официального API/OAuth/feed соглашения.

## Очередь расширения

| Волна | Что сделать | Ожидаемый выигрыш | Условие готовности |
|---|---|---|---|
| 1 | Дополнительные проверенные Workable/Recruitee/Greenhouse/Ashby/Lever slugs | десятки/сотни карьерных досок существующими адаптерами | live-проверка каждой доски и allowlist географии |
| 2 | Generic RSS/Atom registry | десятки niche/remote/academic feeds | официальная ссылка на feed и условия републикации |
| 3 | Активировать France Travail; исследовать EURES и другие official APIs | национальное покрытие Европы | ключ/OAuth и подтверждённые квоты |
| 4 | Активировать Reed/SuperJob/Adzuna и настроить квоты 16 стран | широкий aggregator coverage | добавить ключи, соблюдать атрибуцию и контролировать расход запросов |
| 5 | Разрешённые HTML-адаптеры | остаточные приоритет-A сайты | robots/ToS review, fixtures, change detection |

## Критерий подключения источника

Источник считается подключённым не потому, что его страница один раз открылась. Нужны воспроизводимый запрос, стабильный идентификатор вакансии, оригинальная ссылка, дата публикации/закрытия, правила атрибуции, timeout/backoff, fixtures и тест маппинга. Для credentialed API секреты хранятся только в `.env`/secret manager; в UI и репозиторий попадают лишь имена требуемых переменных.

Итог: технически охват можно довести до большей части 152 источников приоритета A, но не все они должны становиться прямыми скрейперами. Максимально эффективная архитектура — небольшое число переиспользуемых API/ATS/RSS-адаптеров, которые раскрываются в большое число независимо наблюдаемых источников.
