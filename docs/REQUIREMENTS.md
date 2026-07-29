# Матрица требований VacationHunter

Дата аудита: 2026-07-29. Статус относится к текущему локальному MVP; production-масштабирование отмечено отдельно и не подменяет реализованное поведение.

| № | Требование | Реализация | Проверяемое доказательство | Статус |
|---:|---|---|---|---|
| 1 | Разбить естественный запрос на теги и веса | role, skills, location, remote, relocation, experience, employment, salary, exclusions; обязательность и вес | `src/core/query-parser.js`, `tests/query-parser.test.js` | Реализовано |
| 2 | AND выше OR, плавное снижение по пропущенным тегам, зарплата и отсутствие дублей | отдельный AND bucket, `requiredMissCount`, weighted match; salary normalization; dedupe до ranking | `src/core/ranker.js`, `src/core/dedupe.js`, тесты ranker/dedupe | Реализовано |
| 3 | Проверка существования и подлинности | provenance, trusted employer, archived/closed, HTTPS/HTTP, JSON-LD, validThrough, риск-фразы, SSRF-защита | `src/core/authenticity.js`, `tests/authenticity.test.js` | Реализовано; внешняя проверка вероятностная |
| 4 | Минималистичный UI, уточнения, обработка, multi-sort | natural-language form, chips, clarifications, progress, карточки, две сортировки | `public/`, проверка desktop/mobile в браузере | Реализовано |
| 5 | Информативные поля и визуальные статусы | employer, source/link, description, match rail, salary, verification, suspicion, location, freshness, tags, score explanation | `public/index.html`, `public/app.js` | Реализовано |
| 6 | Эффективная загрузка и опциональные свежие результаты | параллельные адаптеры, timeout, retry policy, background scheduler, durable watch store, SSE, watch toggle, cooldown | `src/services/`, `tests/source-resilience.test.js`, `tests/watch-store.test.js` | Реализовано локально |
| 7 | Эффективная агрегация и политика авторизации | tokenized aggregator/official API → public ATS → feed → разрешённый HTML; OAuth/key/partner для закрытого; без bypass | `src/connectors/`, `docs/INGESTION.md`, `docs/RESEARCH.md` | Реализованы 9 типов коннекторов, включая Jooble и USAJOBS |
| 8 | Возможность менять требования | изолированные core/connectors/services/UI, нормализованный Job contract | `docs/ARCHITECTURE.md` | Реализовано |
| 9 | Решения с доказательствами и тест-кейсами | первичные документы API/стандартов, 24 автоматизированных теста | `docs/RESEARCH.md`, `docs/INGESTION.md`, `tests/` | Реализовано для MVP |
| 10 | Отсутствие скрытых белых пятен | источник сообщает disabled/cooldown/error; UI показывает частичные сбои; ограничения документированы | `/api/sources`, source report в UI | Реализовано для известных состояний |

## Что ещё требуется перед production

1. PostgreSQL и история версий вакансий вместо локального JSON.
2. Очередь задач с распределёнными блокировками и DLQ.
3. Реальные credentials/slug-реестр разрешённых источников и юридическая матрица ToS/DPA.
4. Размеченный relevance dataset и сравнение baseline/BM25/hybrid/RRF по nDCG@10 и Recall@50.
5. Наблюдаемость, алерты, лимиты бюджета источников и нагрузочные тесты.
6. Пользовательские аккаунты и durable delivery для email/Telegram, если это войдёт в продуктовый scope.

Эти пункты не нужны для демонстрации текущей логики, но обязательны для эксплуатации агрегатора с большим числом источников и пользователей.
