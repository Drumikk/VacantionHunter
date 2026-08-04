# Настройка ключей и авторизации источников

Дата проверки: 2026-08-04.

Этот документ перечисляет все источники VacationHunter, которым нужен ключ, токен, регистрация приложения, почтовый доступ или партнёрское соглашение. Значения секретов сюда и в git добавлять нельзя: они хранятся только в корневом файле `.env`, который уже исключён через `.gitignore`.

## Краткий итог

В приложении зарегистрировано 210 коннекторов:

- 169 работают без логина и ключей;
- 27 экземпляров требуют обычные credentials, но 16 из них — страны Adzuna с одной общей парой `app_id`/`app_key`;
- 11 допускают или требуют дополнительную регистрацию: The Muse и 10 публичных SmartRecruiters boards;
- 3 являются партнёрскими заглушками: LinkedIn, Indeed и Levels.fyi.

После объединения повторов получается 12 схем обязательной настройки, 2 специальных случая и 3 партнёрских исключения. Из 12 обязательных схем прямой HH API для нового приложения соискателя сейчас практически недоступен; остальные 11 выполнимы при соблюдении требований поставщиков. Отдельно рекомендуется зарегистрировать The Muse, а для публичных SmartRecruiters boards никаких credentials получать не нужно.

## Полная сводная таблица

| Приоритет | Источник | Что добавляет | Что требуется | Переменные `.env` | Реальный статус |
|---|---|---|---|---|---|
| 1 | Adzuna, 16 стран | Великобритания, США, Австрия, Австралия, Бельгия, Бразилия, Канада, Швейцария, Германия, Испания, Франция, Италия, Мексика, Нидерланды, Новая Зеландия, Польша | Обычная регистрация API-приложения | `ADZUNA_APP_ID`, `ADZUNA_API_KEY` | Один аккаунт включает все 16 коннекторов |
| 1 | Jooble | Международный агрегатор | Заявка на API key | `JOOBLE_API_KEY` | Доступен после выдачи ключа; не считать заменой HH/РФ |
| 1 | Reed.co.uk | Вакансии Великобритании | Регистрация API key | `REED_API_KEY` | Простая регистрация; Basic Auth уже реализован |
| 1 | SuperJob | РФ/СНГ | Регистрация приложения и Secret key | `SUPERJOB_SECRET_KEY` | Для публичного поиска пользовательский OAuth не нужен |
| 1 | USAJOBS | Федеральные вакансии США | API key и тот же email, который указан в заявке | `USAJOBS_API_KEY`, `USAJOBS_EMAIL` | Оба значения обязательны |
| 1 | CareerOneStop | Агрегированный официальный поиск по США | Одобренный Web API access, User ID и bearer token | `CAREERONESTOP_USER_ID`, `CAREERONESTOP_API_TOKEN` | Оба значения обязательны |
| 2 | France Travail | Франция и вакансии партнёров France Travail | Приложение с доступом к API Offres d'emploi, OAuth client credentials | `FRANCE_TRAVAIL_CLIENT_ID`, `FRANCE_TRAVAIL_CLIENT_SECRET` | Не нужна интерактивная авторизация соискателя |
| 2 | ReliefWeb Jobs | Международные гуманитарные вакансии | Предварительно одобренный `appname` | `RELIEFWEB_APPNAME` | Это идентификатор, а не секрет, но произвольное имя не подойдёт |
| 2 | Arbeidsplassen/NAV | Большая часть публичных вакансий Норвегии, кроме FINN.no | Частный signed JWT bearer token | `NAV_API_TOKEN` | Бесплатно, но token запрашивается письмом; public token только для экспериментов |
| 2 | The Muse | Международные и remote-вакансии | Аккаунт The Muse и регистрация приложения | `THE_MUSE_API_KEY` | Текущий endpoint может отвечать анонимно, но условия API требуют регистрации приложения |
| 3 | Job Market Finland | Вакансии Финляндии | Организация с Business ID, проверка KEHA, test/production credentials, allowlist IP | `JOBMARKET_FINLAND_API_KEY` | Для частного лица без Business ID обычно неприменимо |
| 3 | HH email alerts | Вакансии из официальных email-уведомлений сохранённых поисков HH | Отдельный IMAP-ящик и пароль приложения | `HH_EMAIL_IMAP_USER`, `HH_EMAIL_IMAP_PASSWORD` | Рабочая автоматизированная альтернатива скрейпингу HH |
| Только старый доступ | HeadHunter API | Прямой поиск HH | Ранее одобренное приложение и OAuth | `HH_USER_AGENT` плюс `HH_ACCESS_TOKEN` **или** `HH_CLIENT_ID` + `HH_CLIENT_SECRET` | Новую регистрацию приложения соискателя не планировать; `HH_USER_AGENT` не является ключом |
| Обычно не нужен | SmartRecruiters, 10 boards | Voyage Privé, Arista, Upwork, Sigma Software, Mirantis, Dynatrace, Docplanner, Rise Up, Canva, Playtech | Для публичного Posting API ничего; ключ доступен клиенту/администратору SmartRecruiters | `SMARTRECRUITERS_API_KEY` | Оставить пустым, если нет собственного SmartRecruiters customer account |
| Партнёрский | LinkedIn Jobs | Закрытая платформа | Одобрение Talent Solutions/Apply Connect, договор, OAuth, затем отдельная реализация адаптера | Сейчас нет обычной `.env`-настройки | Публичного API поиска вакансий нет; обычные cookies/логин использовать нельзя |
| Партнёрский | Indeed | Закрытая платформа | Indeed Partner Console, договор и доступ к конкретному продукту, затем отдельная реализация адаптера | Сейчас нет обычной `.env`-настройки | Открытого глобального Search API для такого агрегатора нет |
| Партнёрский | Levels.fyi Jobs | Закрытая job board | Письменное разрешение именно на jobs feed/API, затем отдельная реализация адаптера | Сейчас нет обычной `.env`-настройки | Публичная страница API относится к compensation data; условия запрещают scraping |
| Не источник | Telegram | Уведомления о новых вакансиях | Бот и chat ID | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Не увеличивает число вакансий, но полезен для автоматической доставки |

## Рекомендуемый порядок регистрации

Чтобы быстрее получить максимальный прирост источников, удобно идти так:

1. Adzuna — одна регистрация сразу для 16 рынков.
2. Reed, SuperJob, USAJOBS и Jooble — обычные формы выдачи ключа.
3. CareerOneStop и France Travail — заявки на доступ к государственным API.
4. ReliefWeb и NAV — ручное одобрение, но процедура документирована.
5. The Muse — зарегистрировать приложение для соответствия API Terms.
6. Job Market Finland — только если есть подходящая организация, Business ID и стабильный исходящий IP.
7. HH email — только если снова решим добавить HH через официальные уведомления.
8. LinkedIn, Indeed и Levels.fyi не задерживают запуск: оставить выключенными до появления партнёрского договора.

## Единая локальная настройка

Все команды выполняются в PowerShell на вашем компьютере.

```powershell
cd "C:\Users\drumi\OneDrive\Документы\VacantionHunter"
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Команда не перезаписывает существующий `.env` и затем открывает его в Блокноте.

Заполните в `.env` только полученные значения:

```dotenv
# Максимальный прирост за одну регистрацию: 16 стран
ADZUNA_APP_ID=
ADZUNA_API_KEY=
ADZUNA_COUNTRIES=gb,us,at,au,be,br,ca,ch,de,es,fr,it,mx,nl,nz,pl

# Международный агрегатор
JOOBLE_API_KEY=

# Великобритания и РФ/СНГ
REED_API_KEY=
SUPERJOB_SECRET_KEY=

# США
USAJOBS_API_KEY=
USAJOBS_EMAIL=
CAREERONESTOP_USER_ID=
CAREERONESTOP_API_TOKEN=

# Франция, гуманитарные вакансии, Норвегия и Финляндия
FRANCE_TRAVAIL_CLIENT_ID=
FRANCE_TRAVAIL_CLIENT_SECRET=
RELIEFWEB_APPNAME=
NAV_API_TOKEN=
NAV_USE_PUBLIC_TOKEN=false
JOBMARKET_FINLAND_API_KEY=

# Регистрация рекомендована условиями The Muse
THE_MUSE_API_KEY=

# Обычно оставить пустым: публичные SmartRecruiters postings работают без него
SMARTRECRUITERS_API_KEY=

# HH через отдельный почтовый ящик — пока можно оставить пустым
HH_EMAIL_IMAP_HOST=imap.gmail.com
HH_EMAIL_IMAP_PORT=993
HH_EMAIL_IMAP_SECURE=true
HH_EMAIL_IMAP_USER=
HH_EMAIL_IMAP_PASSWORD=
HH_EMAIL_IMAP_FOLDER=INBOX
HH_EMAIL_SENDER_DOMAINS=hh.ru,headhunter.ru
HH_EMAIL_LOOKBACK_DAYS=30

# Только если уже есть одобренный HH API-доступ
HH_USER_AGENT="VacationHunter/0.1 (your-email@example.com)"
HH_ACCESS_TOKEN=
HH_CLIENT_ID=
HH_CLIENT_SECRET=

# Не источник вакансий, а доставка уведомлений
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Не вставляйте пробелы вокруг `=`. Значение с пробелами заключайте в двойные кавычки. Пустые строки допустимы: соответствующий коннектор останется выключенным, остальные продолжат работать.

После сохранения полностью перезапустите сервер, потому что `.env` читается один раз при старте:

```powershell
pnpm start
```

## Как получить каждый доступ

### Adzuna

1. Откройте [официальный портал Adzuna](https://developer.adzuna.com/overview).
2. Нажмите **Register**, создайте приложение и подтвердите email.
3. Скопируйте выданные `app_id` и `app_key` в `ADZUNA_APP_ID` и `ADZUNA_API_KEY`.
4. Оставьте все 16 кодов в `ADZUNA_COUNTRIES`, если цель — максимальное покрытие. Все страны расходуют общую квоту, поэтому при ограничениях сначала отключайте наименее нужные рынки.

### Jooble

1. Заполните [официальную форму Jooble REST API](https://jooble.org/api/about).
2. Форма просит имя, должность/роль, email, сайт проекта и телефон. В качестве сайта укажите публичную страницу или репозиторий VacationHunter.
3. После одобрения скопируйте выданный key в `JOOBLE_API_KEY`.
4. Jooble использовать как международный слой; российскую выдачу HH он не заменяет.

### Reed.co.uk

1. На странице [Reed Jobseeker API](https://www.reed.co.uk/developers/jobseeker) укажите имя, фамилию и email.
2. Полученный ключ сохраните как `REED_API_KEY`.
3. Приложение само отправляет этот ключ как username в Basic Auth с пустым password.

### SuperJob

1. На [портале SuperJob API](https://api.superjob.ru/) войдите и зарегистрируйте приложение.
2. Скопируйте **Secret key** приложения в `SUPERJOB_SECRET_KEY`.
3. Для реализованного публичного поиска вакансий access token пользователя не нужен: приложение передаёт Secret key в `X-Api-App-Id`.

### USAJOBS

1. Заполните [официальную API Request form](https://developer.usajobs.gov/APIRequest/Index).
2. Сохраните выданный ключ в `USAJOBS_API_KEY`.
3. В `USAJOBS_EMAIL` впишите **ровно тот email, который был указан в заявке**. Это не email работодателя и не отдельный технический адрес: USAJOBS требует его в HTTP-заголовке `User-Agent` вместе с `Authorization-Key`.

### CareerOneStop

1. Запросите доступ на странице [CareerOneStop Web API](https://www.careeronestop.org/Developers/WebAPI/web-api.aspx).
2. После регистрации откройте [официальный API Explorer](https://api.careeronestop.org/api-explorer/) и возьмите выданные User ID и API token.
3. Запишите их раздельно: `CAREERONESTOP_USER_ID` и `CAREERONESTOP_API_TOKEN`.
4. Token является bearer secret; User ID тоже не следует публиковать без необходимости.

### France Travail

1. Откройте карточку [API Offres d'emploi](https://www.data.gouv.fr/dataservices/api-offres-demploi) и нажмите **Demander un accès**.
2. На портале France Travail создайте приложение и подключите продукт **Offres d'emploi**.
3. Полученные OAuth client credentials сохраните в `FRANCE_TRAVAIL_CLIENT_ID` и `FRANCE_TRAVAIL_CLIENT_SECRET`.
4. Приложение само получает server-to-server access token; redirect URI и вход пользователя для поиска не требуются.

### ReliefWeb

1. В разделе [ReliefWeb appname](https://apidoc.reliefweb.int/parameters#appname) откройте короткую форму запроса.
2. Предложите уникальное имя из названия организации/проекта, цели и случайного суффикса, например `vacationhunter-jobs-a7f3`.
3. Дождитесь письма об одобрении и вставьте **точно одобренное** значение в `RELIEFWEB_APPNAME`.
4. С 1 ноября 2025 года произвольный `appname` без одобрения не подходит.

### Arbeidsplassen/NAV

1. Прочитайте [документацию NAV Job Vacancy Feed](https://navikt.github.io/pam-stilling-feed/) и [условия использования](https://arbeidsplassen.nav.no/vilkar-api).
2. Отправьте письмо на `nav.team.arbeidsplassen@nav.no` с письменным согласием с условиями и следующими данными: identifier/название проекта или компании, контактный email, телефон и контактное лицо.
3. Можно использовать такой шаблон:

```text
Subject: Request for a private Job Vacancy Feed API token — VacationHunter

Hello,

I confirm that I have read and agree to the terms of use for the NAV Job Vacancy Feed.

Identifier: VacationHunter — personal non-commercial job search aggregator
Use case: automated retrieval, deduplication and personal search of active vacancies; inactive vacancies are removed according to the API terms
Contact person: YOUR NAME
Contact email: YOUR EMAIL
Contact phone: YOUR PHONE

Please register me as a consumer and issue a private bearer token.
```

4. Выданный token сохраните как `NAV_API_TOKEN`.
5. `NAV_USE_PUBLIC_TOKEN=true` допустим только для краткого локального эксперимента: публичный token меняется через нерегулярные интервалы и не годится для постоянной автоматизации.

### The Muse

1. Создайте или используйте аккаунт The Muse.
2. Откройте [регистрацию API application](https://www.themuse.com/developers/api/v2/apps); неавторизованного пользователя перенаправит на login.
3. Зарегистрируйте VacationHunter и сохраните key как `THE_MUSE_API_KEY`.
4. [Действующие API Terms](https://www.themuse.com/developers/api/v2/terms) требуют регистрации приложения, обратной ссылки на The Muse и запрещают HTML scraping. Коннектор использует только API и сохраняет оригинальную ссылку.

### Job Market Finland

1. Изучите [официальный onboarding интерфейсов вакансий](https://tyomarkkinatori.fi/en/instructions-and-support/interfaces/interfaces-for-job-postings).
2. Организация с Business ID подаёт activation form и принимает условия.
3. KEHA Centre проверяет право использования, выдаёт test credentials и открывает нужные сетевые соединения/IP.
4. После тестирования организация отдельно просит production credentials. Контакт: `tmt-rajapinnat.keha@ely-keskus.fi`.
5. Production subscription key сохраните как `JOBMARKET_FINLAND_API_KEY`. Коннектор передаёт его в `KIPA-Subscription-Key`.
6. Для локального компьютера с меняющимся публичным IP доступ может быть неудобен; лучше указывать стабильный egress IP развёрнутого сервера.

### HH через email alerts

1. Создайте отдельный почтовый ящик только для уведомлений о вакансиях.
2. В HH создайте сохранённые поиски и включите официальные email-уведомления на этот адрес.
3. Для Gmail включите двухэтапную аутентификацию и создайте отдельный 16-значный [пароль приложения Google](https://support.google.com/accounts/answer/185833). Используйте его вместо основного пароля; пробелы из отображаемого пароля удалите.
4. Укажите email в `HH_EMAIL_IMAP_USER`, пароль приложения в `HH_EMAIL_IMAP_PASSWORD`, а для Gmail оставьте `imap.gmail.com`, порт `993` и TLS.
5. Для другого провайдера замените host/port и используйте его пароль приложения. Текущий коннектор поддерживает IMAP login/password, а не интерактивный OAuth почтового провайдера.

### Прямой HH API

`HH_USER_AGENT` не нужно получать. Это идентификатор вашего клиента с реальным контактом, например:

```dotenv
HH_USER_AGENT="VacationHunter/0.1 (your-email@example.com)"
```

Одного `HH_USER_AGENT` недостаточно. Нужен либо готовый `HH_ACCESS_TOKEN`, либо ранее одобренные `HH_CLIENT_ID` и `HH_CLIENT_SECRET`. В форме регистрации HH указано, что поддержка API для приложений соискателей прекращена 15 декабря 2025 года, поэтому новый applicant-only доступ не следует считать выполнимым этапом. Логин, пароль, cookies и обход CAPTCHA приложение не использует.

### SmartRecruiters

VacationHunter читает только публичные Posting API endpoints компаний. По [официальной документации SmartRecruiters](https://developers.smartrecruiters.com/docs/customer-overview) такие endpoints допускают доступ без аутентификации.

`SMARTRECRUITERS_API_KEY` нужен только владельцу или администратору конкретного SmartRecruiters customer account. Такой ключ выдаётся через Credential Manager и даёт чувствительный доступ к ресурсам организации; он не является глобальным ключом для чтения чужих вакансий. Для текущих десяти публичных boards оставьте переменную пустой.

## Партнёрские источники, которые нельзя «просто настроить»

### LinkedIn

[LinkedIn Job Posting API](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview) предназначен для одобренных ATS/job-distribution партнёров, требует договора и OAuth. Более того, LinkedIn сообщает, что новые партнёрства именно для Job Posting API сейчас не принимаются и направляет кандидатов в Apply Connect. Это API публикации/управления вакансиями, а не открытый API глобального поиска.

### Indeed

[Indeed Partner Docs](https://docs.indeed.com/getstarted) описывают интеграции через Partner Console для управления jobs, employers и candidates. Обычного ключа, который даст нашему приложению глобальный каталог Indeed для поиска, нет. После партнёрского одобрения потребуется реализовать адаптер под конкретно выданный продукт и его договорные ограничения.

### Levels.fyi

[Публичная страница API access Levels.fyi](https://www.levels.fyi/api-access/) предлагает коммерческий доступ к compensation data, а не документированный jobs-search feed. [Условия Levels.fyi](https://www.levels.fyi/about/terms.html) запрещают автоматические scrapers/crawlers. Поэтому нужен отдельный письменный доступ именно к вакансиям; до него коннектор остаётся выключенным.

## Проверка после настройки

После перезапуска откройте приложение и нажмите обновление источников либо проверьте реестр безопасной командой — значения ключей она не показывает:

```powershell
$sources = Invoke-RestMethod 'http://127.0.0.1:4173/api/sources'
$sources |
  Where-Object { -not $_.enabled } |
  Select-Object name, authType, disabledReason |
  Format-Table -Wrap -AutoSize
```

Для сводного количества:

```powershell
$sources = Invoke-RestMethod 'http://127.0.0.1:4173/api/sources'
[pscustomobject]@{
  Total = $sources.Count
  Enabled = @($sources | Where-Object enabled).Count
  Disabled = @($sources | Where-Object { -not $_.enabled }).Count
}
```

`enabled` означает, что конфигурация коннектора полна. Реальную доступность сети и корректность credentials проверяет поиск или индивидуальная проверка источника; ответы `401`, `403` и `429` переводят источник в безопасный cooldown, не останавливая остальные источники.

## Безопасность

- Не присылайте ключи в чат и не вставляйте их в README, issue, commit или скриншот.
- Храните локальные значения только в `.env`; он уже исключён из git.
- Для HH email используйте отдельный ящик и отдельный пароль приложения, а не основной пароль.
- Не переносите `.env` целиком в GitHub. Для GitHub Actions каждый секрет добавляется отдельно в repository secrets и явно подключается в workflow.
- После случайной публикации секрета немедленно отзовите/перевыпустите его, а не просто удалите из последнего commit.
- После заполнения пришлите только список названий настроенных источников. Проверку можно выполнить по статусам, не раскрывая значения.
