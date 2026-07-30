# Статус живых источников

Дата снимка: 2026-07-29 22:53 UTC. Окружение: локальный Windows egress. Запрос:

```text
.NET Разработчик с заработной платой от 4000$ в месяц, удалённо с релокацией
```

Это операционный снимок, а не обещание постоянной доступности внешних сайтов. Источник считается `ok`, если коннектор получил и корректно обработал ответ; ноль подходящих вакансий не является ошибкой источника.

## Итог

| Метрика | Значение |
|---|---:|
| Всего наблюдаемых источников | 23 |
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
| Remote API | Remotive | error | Cloudflare 403 для локального IP; проверить GitHub Actions/deployment egress, challenge не обходить |
| Remote API | Arbeitnow | error | Cloudflare 403 для локального IP; проверить GitHub Actions/deployment egress, challenge не обходить |
| Partner-only | LinkedIn | disabled | Нужен официальный Talent Solutions partner access; login cookies не используются |
| Partner-only | Indeed | disabled | Нужен официальный партнёрский доступ; login scraping не используется |
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
```

Scheduled workflow сохраняет полный JSON как GitHub Actions artifact и краткую таблицу в job summary. После добавления HH-авторизации (`HH_USER_AGENT` + `HH_ACCESS_TOKEN` либо `HH_CLIENT_ID` + `HH_CLIENT_SECRET`), `JOOBLE_API_KEY`, `USAJOBS_API_KEY` и `USAJOBS_EMAIL` в repository secrets те же API-коннекторы автоматически переходят из `disabled` в реальную проверку без изменения кода. IMAP-доступ к личной почте безопаснее держать локально либо в отдельном секрет-хранилище развёрнутого сервера, а не в CI общего репозитория.
