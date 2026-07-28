# Доказательная база решений

Дата проверки: 2026-07-29. Для технических решений использованы первичные документы владельцев API и стандартов.

| Решение | Первичный источник | Что подтверждает | Реализация |
|---|---|---|---|
| HH через JSON API | <https://api.hh.ru/openapi/redoc> | HTTPS/JSON, обязательный User-Agent, поиск по тексту, зарплате, валюте, дате; employer `trusted`, `archived`, `closed_for_applicants` | `src/connectors/hh.js` |
| Greenhouse public Job Board API | <https://developer.greenhouse.io/job-board.html> | Публичное получение опубликованных jobs; application POST требует auth | `src/connectors/greenhouse.js` |
| Lever public Postings API | <https://hire.lever.co/developer/support> | Postings API публично отдаёт опубликованные вакансии | `src/connectors/lever.js` |
| Ashby public Job Postings API | <https://developers.ashbyhq.com/docs/public-job-posting-api> | Список опубликованных вакансий и `includeCompensation=true` | `src/connectors/ashby.js` |
| Remotive public API | <https://remotive.com/remote-jobs/api> | Разрешена републикация с атрибуцией; public jobs задержаны на 24 часа | `src/connectors/remotive.js` |
| Arbeitnow API | <https://www.arbeitnow.com/blog/job-board-api> | No-key API, ATS-derived jobs, remote и visa sponsorship поля | `src/connectors/arbeitnow.js` |
| Актуальность JobPosting | <https://developers.google.com/search/docs/appearance/structured-data/job-posting> | `datePosted`, `validThrough`, полный текст, способ отклика; запрет expired/fake/pay-to-apply | `src/core/authenticity.js` |
| Robots Exclusion Protocol | <https://www.rfc-editor.org/rfc/rfc9309> | Стандартизированный robots.txt для HTML crawler | production policy |
| Hybrid retrieval | <https://www.elastic.co/docs/solutions/search/hybrid-search> | lexical + vector search, рекомендация RRF | production roadmap |
| RRF формула | <https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion> | Fusion по рангам без общей шкалы scores | production roadmap |
| Multi-stage ranking | <https://www.elastic.co/docs/solutions/search/ranking> | дешёвый initial retrieval и более дорогой reranking на малом candidate set | production roadmap |

## Операционная проверка API 2026-07-29

- HH вернул `bad_user_agent` для фиктивного домена в контактном адресе и `forbidden` для User-Agent без контакта. Поэтому в приложении нет небезопасного значения по умолчанию: оператор обязан задать реальный `HH_USER_AGENT`.
- Remotive JSON API и документированный RSS (`https://remotive.com/feed`) с текущего тестового IP вернули Cloudflare 403. Это инфраструктурная блокировка, а не доказательство закрытия API; коннектор переводится в cooldown, атрибуция и обратная ссылка остаются обязательными.
- Arbeitnow по-прежнему документирует no-key API и обновил страницу 9 марта 2026 г., но текущий тестовый IP получает managed Cloudflare challenge. Обход не применяется; используются cooldown, другой разрешённый deployment egress или договорной API.

Такая проверка намеренно различает «API существует по документации» и «API доступен из конкретного окружения сейчас».

Стартовый пакет из 15 company boards проверен прямыми запросами к публичным API 2026-07-29 и хранится в `config/sources.json`; каждая доска обновляется и наблюдается независимо:

- Ashby: Qdrant, Enode, Percona, Reedsy, Granular Energy — все вернули `apiVersion=1`, опубликованные вакансии и прямые `jobUrl`;
- Greenhouse: Canonical, Grafana Labs, Elastic, GitLab, Cloudflare — от 131 до 302 опубликованных вакансий на момент проверки;
- Lever: SwissBorg, Zartis, Aircall, PayU GPO, Match Group — от 4 до 83 опубликованных вакансий на момент проверки.

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
