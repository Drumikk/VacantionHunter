# Автоматический сбор вакансий

Дата проверки: 2026-07-29.

## Как обычно устроены агрегаторы вакансий

Надёжный агрегатор не является одним универсальным HTML-парсером. Он использует каскад независимых адаптеров:

1. официальный API или партнёрский агрегатор с API key/OAuth;
2. публичный Job Board API конкретной ATS;
3. документированный RSS/XML/JSON feed;
4. разрешённый HTML-адаптер с robots.txt, rate limit и conditional requests;
5. авторизованный браузер — только если площадка письменно разрешает автоматизацию такого сценария.

Каждый адаптер переводит ответ в единый `Job`, после чего общая система выполняет дедупликацию, проверку происхождения, оценку актуальности, ранжирование и сохранение. Scheduler повторяет запросы автоматически, кэш не допускает повторного списания квоты за одинаковый запрос, а circuit breaker ставит источник на паузу при 401/403/429, Cloudflare или временном сбое.

Cookies, пароль и пользовательская сессия не являются заменой API. Например, LinkedIn прямо запрещает scripts/robots для scraping и копирование cookies в своём User Agreement. Официальный LinkedIn Jobs API доступен только одобренным Talent Solutions Partners и предназначен для публикации/управления объявлениями, а не для общедоступного поиска вакансий.

## Выбранная схема VacationHunter

| Слой | Покрытие | Авторизация | Статус |
|---|---|---|---|
| Jooble REST API | Агрегатор вакансий из job boards, карьерных страниц и рекрутеров в десятках стран | `JOOBLE_API_KEY` | Реализовано; основной широкий слой |
| HeadHunter API | РФ/СНГ | идентифицирующий `HH_USER_AGENT` | Реализовано |
| Greenhouse, Ashby, Lever | Публичные вакансии конкретных работодателей | не требуется для чтения | Реализовано, 15 стартовых boards |
| USAJOBS Search API | Федеральные вакансии США | API key + email в заголовках | Реализовано |
| Remotive, Arbeitnow | Международные remote-вакансии | публичный API | Реализовано; возможна IP/Cloudflare-пауза |
| Adzuna API | Западные национальные рынки | `app_id` + `app_key` | Исследовано; отложено до согласования лицензии и обязательной бренд-атрибуции |
| LinkedIn / Indeed | Крупные закрытые площадки | партнёрский договор | Не скрейпятся; открытого search API для этого сценария нет |

Jooble выбран первым: официальный API принимает `keywords`, `location`, radius, salary и pagination и возвращает источник, компанию, ссылку, тип, зарплату и время обновления. Сама площадка описывает себя как агрегатор вакансий из множества интернет-источников, поэтому один договорной API даёт больший охват и меньшую стоимость поддержки, чем десятки хрупких HTML-парсеров.

USAJOBS добавлен как пример прямого tokenized API: он требует `Authorization-Key` и email в `User-Agent`, поддерживает keyword/location/remote/date filters и возвращает нормализуемую зарплату, срок приёма заявок и прямую apply-ссылку.

## Получение ключей

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

### USAJOBS — дополнительный источник

1. Запросить ключ на <https://developer.usajobs.gov/APIRequest/Index>.
2. Использовать тот же email, который был указан при запросе ключа.

```powershell
$env:USAJOBS_API_KEY='полученный-ключ'
$env:USAJOBS_EMAIL='ваш-email@example.com'
npm start
```

### HeadHunter

```powershell
$env:HH_USER_AGENT='VacationHunter/0.2 (contact: ваш-email@example.com)'
```

## Эксплуатационные ограничения

- Секреты задаются только на сервере через environment/secret manager; в `config/sources.json` их быть не должно.
- Одинаковый запрос к tokenized API кэшируется на `AGGREGATOR_CACHE_MS` (по умолчанию 15 минут).
- 401/403 дают длительный cooldown, 429 учитывает `Retry-After`, временные ошибки получают exponential backoff.
- Система не обходит CAPTCHA, Cloudflare, paywall, login wall или ограничения выдачи.

## Автоматическая доставка результатов

Сохранённый поиск обновляется планировщиком и сравнивается с `knownJobIds`. Для новых ID формируется Telegram-дайджест максимум из `NOTIFICATION_MAX_JOBS` вакансий. Событие сначала кладётся в `data/notification-outbox.json` и получает детерминированный dedupe key из watch ID и набора вакансий; только после этого новые ID фиксируются в durable watch store. Такой порядок не теряет событие при остановке процесса между записями, а повторная постановка схлопывается dedupe key.

Telegram подключается через `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID`. Токен создаётся официальным `@BotFather`; пользователь должен сначала написать боту, поскольку бот не может сам начать личный диалог. Если задан только токен, `POST /api/notifications/discover` читает `getUpdates` и возвращает безопасный список последних chat ID без токена. `POST /api/notifications/test` проверяет готовую конфигурацию.

Доставка использует `sendMessage`, plain text не длиннее 4000 символов и отключённые link previews. Очередь сериализует отправку, сохраняет попытки и `message_id`; для flood control применяется полученный `retry_after`, для остальных ошибок — exponential backoff. После исчерпания попыток запись становится `failed`, а ручная команда «Повторить очередь» возвращает dead-letter записи в доставку. Статус доступен в `GET /api/notifications/status` без значений credentials.
- Adzuna по умолчанию не включён: официальные условия указывают базовые лимиты 25 запросов/минуту и 250/день, обязательную атрибуцию при публикации объявлений и возможную лицензию для длительного использования.

## Первичные документы

- Jooble REST API: <https://help.jooble.org/en/support/solutions/articles/60001448238-rest-api-documentation>
- Jooble API registration: <https://jooble.org/api/about>
- Adzuna overview/search/terms: <https://developer.adzuna.com/overview>, <https://developer.adzuna.com/docs/search>, <https://developer.adzuna.com/docs/terms_of_service>
- USAJOBS authentication/search: <https://developer.usajobs.gov/guides/authentication>, <https://developer.usajobs.gov/api-reference/get-api-search>
- LinkedIn User Agreement: <https://www.linkedin.com/legal/user-agreement>
- LinkedIn partner Jobs API: <https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/create-apply-connect-jobs>
- Indeed Partner API guides: <https://docs.indeed.com/api-guides/>
- Telegram Bot API `sendMessage`, `getUpdates` и `retry_after`: <https://core.telegram.org/bots/api>
- Официальное создание бота через BotFather: <https://core.telegram.org/bots/features#botfather>
