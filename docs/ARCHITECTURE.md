# Архитектура VacationHunter

Дата решений: 2026-07-29.

## Сквозной поток

```mermaid
flowchart LR
  Q[Запрос пользователя] --> P[Query Parser]
  P --> C{Нужны уточнения?}
  C -->|да| UI[Минимальная форма уточнений]
  C -->|нет| O[Оркестратор источников]
  UI --> O
  O --> A[Public APIs / ATS feeds]
  O --> H[HTML adapters — только разрешённые]
  A --> N[Нормализация Job]
  H --> N
  N --> D[Дедупликация]
  D --> V[Authenticity / freshness]
  V --> R[AND bucket + weighted OR ranking]
  R --> S[Сортировка по 1–2 полям]
  S --> X[Объяснимая выдача]
  O --> B[Background refresh]
  B --> E[SSE новые вакансии]
  E --> X
```

## Контракт нормализованной вакансии

Обязательный минимум: `id`, `externalId`, `title`, `company`, `description`, `url`, `source`, `postedAt`. Структурные поля: `skills[]`, `location`, `remote`, `relocation`, `visaSponsorship`, `employmentType`, `experience`, `salary {min,max,currency,period}`. Вычисляемые поля: `salaryMonthlyUsd`, `verification`, `matchPercent`, `andMatch`, `scoreBreakdown`, `duplicateCount`, `sourceUrls[]`.

## Разбор запроса

MVP использует детерминированные правила и словари: результат быстрый, тестируемый и объяснимый. Каждый тег имеет:

- тип и нормализованное значение;
- вес важности;
- `required`, определяющий верхнюю AND-группу;
- источник извлечения и возможность уточнения.

LLM-парсер можно добавить как второй адаптер, но его JSON должен валидироваться той же схемой, а результат — проходить детерминированные проверки валюты, периода и противоречий. Это не должно быть единственной логикой продукта.

## Ранжирование

Текущий ранкер специально соответствует пользовательскому примеру:

1. Сначала вакансии, где выполнены все обязательные теги (`andMatch=true`).
2. Внутри группы — релевантность, затем нормализованная зарплата и свежесть.
3. Затем OR-группа: чем больше вес совпавших тегов, тем выше позиция.
4. Неуказанная зарплата не удаляет вакансию, но даёт 0 по зарплатному сигналу.
5. Java-вакансия с $10k не обгоняет .NET-вакансию с $8k по запросу .NET.
6. `suspicious/stale` демотируются ниже безопасных результатов независимо от зарплаты и пользовательской сортировки.

Скоринг MVP: теги 70%, зарплата 15%, свежесть 8%, проверка 5%, качество источника 2%. Все компоненты возвращаются в `scoreBreakdown`.

Production-путь: дешёвый structured filter + BM25 retrieval → semantic retrieval → RRF → бизнес-реранкер. Elastic рекомендует RRF для объединения lexical и semantic выдач без калибровки несовместимых шкал: <https://www.elastic.co/docs/solutions/search/hybrid-search> и <https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion>.

## Дедупликация

Каскад, от дешёвого и надёжного к приближённому:

1. `(source_id, external_id)` — уникальный ключ.
2. Canonical URL без tracking-параметров.
3. SHA-256 fingerprint `company + title + location`.
4. Fuzzy Jaccard по title только при одинаковой компании и совместимой локации.

Дубликаты сливаются, а `sources[]`, `sourceUrls[]` и `duplicateCount` сохраняются. Один объект не может одновременно попасть в AND и OR: bucket вычисляется после дедупликации.

## Проверка подлинности и актуальности

Нет одного достоверного признака. Модуль собирает независимые сигналы:

- вакансия пришла из официального API или публичного ATS-фида;
- работодатель помечен источником как trusted или объявление получено с его ATS-board;
- HTTPS URL и путь отклика существуют;
- HTTP 2xx на live-проверке;
- `JobPosting` JSON-LD существует, `validThrough` не истёк;
- источник не помечает вакансию `archived/closed`;
- нет запроса оплаты кандидатом, chat-only контакта, анонимного работодателя и слишком пустого описания.

Google прямо требует удалять истёкшие вакансии либо указывать прошедший `validThrough`, запрещает фиктивные объявления, объявления без способа отклика и требования оплаты: <https://developers.google.com/search/docs/appearance/structured-data/job-posting>.

Live-проверка защищена от SSRF: только HTTPS, DNS lookup, запрет loopback/private/link-local адресов, timeout и лимит размера HTML. В UI статус показывается отдельно от `companyVerified`.

## Сбор и обновление

Порядок выбора интеграции:

1. Официальный API источника.
2. Публичный Job Board API ATS работодателя.
3. RSS/XML/JSON feed с явными условиями атрибуции.
4. Разрешённый HTML-парсер с RFC 9309 robots.txt, rate limit, conditional GET и изолированным адаптером.
5. Если нужна авторизация — официальный OAuth/API key/партнёрство. Обход логина, CAPTCHA, paywall и антибота не является допустимой архитектурой.

MVP выполняет изолированные параллельные запросы, timeout/retry только для временных сбоев, сохраняет состояние каждого источника и не ломает общую выдачу при сбое одного коннектора. 401/403 и Cloudflare challenge дают шестичасовой cooldown, 429 учитывает `Retry-After`, остальные ошибки получают экспоненциальную паузу. Повторный refresh во время cooldown возвращает `skipped` и не делает сетевой запрос. CAPTCHA и challenge не обходятся.

HH — отдельный случай конфигурации: коннектор виден как `disabled`, пока оператор не задаст `HH_USER_AGENT` с реальным контактным email. Это предотвращает циклические запросы с заведомо заблокированным фиктивным заголовком.

Для production:

- PostgreSQL — источник истины и история вакансии;
- OpenSearch/Elasticsearch — BM25, facets, vectors, RRF;
- Redis + BullMQ/Temporal — очереди, retry/backoff, распределённые блокировки;
- object storage — raw snapshots для аудита;
- OpenTelemetry — latency, error rate, freshness lag, parse success;
- DLQ для сломавшихся адаптеров.

## Модель обновлений

- API/ATS: 5–15 минут для активных источников, реже для низкообъёмных.
- HTML: адаптивно 30–180 минут с conditional requests и jitter.
- Вакансия исчезла из полного ATS snapshot: `missing_since`, повторная проверка, затем `closed`.
- Пользователь включает «следить»: запрос хранится, фоновые обновления публикуют SSE/WebSocket событие; email/Telegram — отдельный opt-in delivery модуль.

## Метрики качества

- `nDCG@10`, `MRR`, `Recall@50` по размеченному набору запросов;
- доля полных AND-совпадений в top-10;
- duplicate rate до/после merge;
- stale rate и false-positive verification;
- p50/p95 latency, source freshness lag, connector success rate;
- conversion: open → apply, с поправкой на позицию.

Перед обучением весов нужен набор: запрос, вакансия, оценка 0–3, причина, факт отклика/интервью. До этого детерминированный скоринг честнее непрозрачного ML.
