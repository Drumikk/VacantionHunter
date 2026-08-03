# Статус живых источников

Основной снимок: 2026-07-29 22:53 UTC. Новые источники точечно проверены 2026-08-04. Текущая стандартная конфигурация содержит 207 независимо наблюдаемых коннекторов; таблица итогов ниже сохраняет базовый снимок 23 источников для воспроизводимости. Окружение: локальный Windows egress. Запрос:

```text
.NET Разработчик с заработной платой от 4000$ в месяц, удалённо с релокацией
```

Это операционный снимок, а не обещание постоянной доступности внешних сайтов. Источник считается `ok`, если коннектор получил и корректно обработал ответ; ноль подходящих вакансий не является ошибкой источника.

## Итог

| Метрика | Значение |
|---|---:|
| Источников в базовом снимке | 23 |
| Источников в текущей стандартной конфигурации | 207 |
| Успешно ответили | 13 |
| Отключены до настройки доступа | 5 |
| Ошибка из текущего egress | 5 |
| Полные совпадения обязательных условий | 1 |
| Частичные релевантные совпадения | 4 |

Полное совпадение: [Sola — Software Engineer, Windows AI Automation](https://jobs.ashbyhq.com/sola/9a9c39a9-6a15-4b76-b538-f7d219fdb92e), remote, relocation support, USD 160–300k/year, нормализованный нижний порог USD 13,333/month, match 100%.

## Независимая проверка GitHub Actions

[Workflow run 30499493796](https://github.com/Drumikk/VacantionHunter/actions/runs/30499493796) на commit `66fb7cc` завершился успешно 2026-07-29:

| Метрика | GitHub Actions |
|---|---:|
| Всего наблюдаемых источников | 23 |
| Успешно ответили | 18 |
| Отключены до настройки доступа | 5 |
| Ошибки включённых источников | 0 |
| Полные совпадения обязательных условий | 1 |
| Релевантные частичные совпадения | 5 |

В CI успешно ответили Remotive, Arbeitnow и все пять Greenhouse boards, которые частично блокировались или зависали из локального Windows egress. Это подтверждает, что их коннекторы и официальные endpoints работоспособны, а локальные ошибки являются инфраструктурно-зависимыми. Machine-readable JSON сохранён как artifact запуска.

## Матрица

| Группа | Источник | Статус | Результат / действие |
|---|---|---|---|
| Direct API | HeadHunter | restricted | Новые приложения соискателей не принимаются; работает только ранее одобренный токен |
| Email alerts | HeadHunter email alerts | ready, credentials required | Рабочий путь для соискателя: отдельный IMAP-ящик получает официальные уведомления сохранённого поиска HH |
| Aggregator API | Jooble | ok outside РФ | API работает для международной выдачи; РФ и hh.ru не покрываются |
| Government API | USAJOBS | disabled | Получить `USAJOBS_API_KEY` и указать регистрационный `USAJOBS_EMAIL` |
| Government API | CareerOneStop | disabled | Запросить Web API access и указать `CAREERONESTOP_USER_ID` + `CAREERONESTOP_API_TOKEN`; unit mapping и защита секрета прошли |
| Remote API | Remotive | error | Cloudflare 403 для локального IP; проверить GitHub Actions/deployment egress, challenge не обходить |
| Remote API | Arbeitnow | error | Cloudflare 403 для локального IP; проверить GitHub Actions/deployment egress, challenge не обходить |
| Partner-only | LinkedIn | disabled | Нужен официальный Talent Solutions partner access; login cookies не используются |
| Partner-only | Indeed | disabled | Нужен официальный партнёрский доступ; login scraping не используется |
| Government API | Работа России | ok | 16 .NET-вакансий в live-проверке; 16 релевантных частичных совпадений |
| Government API | Arbetsförmedlingen JobTech | ok | 20 записей обработано; 9 релевантных частичных совпадений |
| Remote API | Remote OK | egress timeout | Unit mapping прошёл; официальный endpoint не ответил из локального Windows egress |
| RSS | We Work Remotely | egress timeout | Unit XML/RSS mapping прошёл; официальный feed не ответил из локального Windows egress |
| Community API | Hacker News Who Is Hiring | ok | 3 полных совпадения через HN Algolia API |
| International API | ReliefWeb | disabled | Нужен предварительно одобренный `RELIEFWEB_APPNAME` |
| Recruitee | 7 company boards | ok | Исходные 6 boards и добавленный bunq вернули HTTP 200 и непустые offers |
| Aggregator API | Adzuna (16 стран по умолчанию) | disabled | Нужны `ADZUNA_APP_ID` и `ADZUNA_API_KEY`; список стран задаётся `ADZUNA_COUNTRIES` |
| Remote API | Himalayas | egress timeout | Публичный API без ключа; unit mapping прошёл, локальный endpoint не ответил за два таймаута |
| Remote API | Jobicy | egress timeout | Публичный API без ключа; unit mapping и часовой кэш прошли, локальный endpoint не ответил за два таймаута |
| UK API | Reed.co.uk | disabled | Получить `REED_API_KEY`; адаптер уже использует документированный Basic Auth |
| РФ/СНГ API | SuperJob | disabled | Зарегистрировать приложение и указать `SUPERJOB_SECRET_KEY`; OAuth пользователя не нужен |
| Government API | France Travail | disabled | Запросить доступ к API Offres d'emploi и задать `FRANCE_TRAVAIL_CLIENT_ID` + `FRANCE_TRAVAIL_CLIENT_SECRET` |
| Workable | 19 company boards | ok | Все выбранные accounts вернули HTTP 200 и структурированные опубликованные jobs при прямой проверке 2026-07-31 |
| Job board API | The Muse | egress timeout | Endpoint вернул HTTP 200 и начало валидного JSON со схемой вакансий; полный body не завершился из локального Windows egress за 90 s, unit mapping прошёл, страницы кэшируются на час |
| Personio | 16 company boards | ok / partial egress timeout | Добавлены непустые XML feeds getquin и Meister; доски изолированы независимо |
| SmartRecruiters | 10 company boards | local Cloudflare 403 | Career pages актуальны, Posting API корректно классифицирован как challenge; обход не применяется, нужен CI/deployment egress или допустимый server key |
| Greenhouse expansion | 17 новых company boards | ok | Databricks, Stripe, Datadog, MongoDB, Okta, Remote, Reddit, Figma, Twilio, Coinbase, Klaviyo, Intercom, Discord, Webflow, Cockroach Labs, commercetools и CircleCI: HTTP 200, ненулевые jobs 2026-08-04 |
| Ashby expansion | 12 новых company boards | ok | PostHog, Linear, Supabase, Neon, n8n, Modal, Render, Resend, Infisical, ElevenLabs, Temporal и OpenAI: HTTP 200, ненулевые jobs 2026-08-04 |
| Lever expansion | 2 новых company boards | ok | Spotify и Palantir: HTTP 200, 102 и 302 опубликованные вакансии соответственно |
| ATS expansion II | 73 новых company boards | ok | 45 Greenhouse, 21 Ashby, 5 Lever и 2 Personio board вернули HTTP 200 и непустой список; повторный ClickHouse feed во второй ATS исключён как дубль |
| Greenhouse | Canonical | error | Большой public index не завершил body download за 3 × 30 s из локального egress |
| Greenhouse | Grafana Labs | ok | Ответ обработан, точных кандидатов нет |
| Greenhouse | Elastic | error | Большой public index не завершил body download за 3 × 30 s из локального egress |
| Greenhouse | GitLab | ok | Ответ обработан, точных кандидатов нет |
| Greenhouse | Cloudflare | error | Большой public index не завершил body download за 3 × 30 s из локального egress |
| Ashby | Sola | ok | 1 полное совпадение |
| Ashby | Qdrant | ok | Ответ обработан, точных кандидатов нет |
| Ashby | Enode | ok | Ответ обработан, точных кандидатов нет |
| Ashby | Percona | ok | Ответ обработан, точных кандидатов нет |
| Ashby | Reedsy | ok | Ответ обработан, точных кандидатов нет |
| Ashby | Granular Energy | ok | 1 частичное совпадение: remote и salary, без relocation |
| Lever | SwissBorg | ok | Полный индексный проход, точных кандидатов нет |
| Lever | Zartis | ok | Частичное .NET/remote совпадение, без salary/relocation |
| Lever | Aircall | ok | Индекс обработан; таймауты отдельных detail pages сохранены как warnings |
| Lever | PayU GPO | ok | Полный индексный проход, точных кандидатов нет |
| Lever | Match Group | ok | 2 частичных совпадения; таймауты отдельных detail pages сохранены как warnings |

## Воспроизведение

```powershell
npm test
npm run smoke:live -- ".NET Разработчик с заработной платой от 4000$ в месяц, удалённо с релокацией"
npm run smoke:live -- --source=ashby:sola
npm run smoke:live -- --source=lever
npm run smoke:live -- --source=trudvsem ".NET developer remote"
npm run smoke:live -- --source=jobtech-sweden ".NET developer remote"
npm run smoke:live -- --source=hn-who-is-hiring ".NET developer remote"
npm run smoke:live -- --source=recruitee ".NET developer remote"
npm run smoke:live -- --source=himalayas ".NET developer remote"
npm run smoke:live -- --source=jobicy ".NET developer remote"
npm run smoke:live -- --source=workable ".NET developer remote"
npm run smoke:live -- --source=france-travail ".NET developer remote"
npm run smoke:live -- --source=the-muse ".NET developer remote"
npm run smoke:live -- --source=personio:iits ".NET developer remote"
npm run smoke:live -- --source=smartrecruiters:AristaNetworks "software engineer remote"
```

Scheduled workflow сохраняет полный JSON как GitHub Actions artifact и краткую таблицу в job summary. После добавления HH-авторизации (`HH_USER_AGENT` + `HH_ACCESS_TOKEN` либо `HH_CLIENT_ID` + `HH_CLIENT_SECRET`), `JOOBLE_API_KEY`, `USAJOBS_API_KEY` и `USAJOBS_EMAIL` в repository secrets те же API-коннекторы автоматически переходят из `disabled` в реальную проверку без изменения кода. IMAP-доступ к личной почте безопаснее держать локально либо в отдельном секрет-хранилище развёрнутого сервера, а не в CI общего репозитория.
