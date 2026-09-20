# API локальной версии

Все суммы — целые копейки, кроме числа бонусов. Время — ISO 8601; группировка отчётов — Europe/Moscow. Ошибки: `{ error, message, requestId?, fields? }`. API-контракт пока версии 0.2; использовать только для совместной разработки, не фиксировать публичную стабильность.

## Администраторы

`POST /api/auth/login`: `{ email, password, code? }`; обязательный Origin, устанавливает HttpOnly cookie. `GET /api/auth/me` возвращает роль, бизнес и CSRF. Все изменяющие административные запросы требуют cookie, совпадающий Origin и заголовок `X-CSRF-Token`.

- `POST /api/auth/logout`
- `POST /api/auth/totp/start` → секрет для приложения-аутентификатора
- `POST /api/auth/totp/confirm`: `{ code }`

## Оператор платформы

- `GET /api/platform/tenants`
- `POST /api/platform/tenants`: `{ id, name, email }`
- `PATCH /api/platform/tenants/:tenant`: `{ acceptingOrders, disabledFeatures: ["theme", "promotions"], reason }`
- `GET /api/platform/audit`
- `GET /api/platform/mail`
- `POST /api/platform/mail/reminders`

## Кабинет бизнеса

Префикс `/api/admin/:tenant`. Доступ определяется серверной ролью и tenant сессии, а не параметром клиента.

- `GET /overview`
- `GET|POST /brand`, `/branch`, `/paymentMethod`, `/tariff`, `/promo`
- `PUT /brand/:id`, `/branch/:id`, `/paymentMethod/:id`, `/promo/:id`: `{ revision, data }`; тарифы неизменяемы, новая дата — новая запись.
- `GET /catalog`
- `GET /themes/:brand`, `PUT /themes/:brand`: `{ revision, data: theme }`
- `POST /themes/:brand/publish`: `{ revision, restoreVersion? }`
- `GET /orders?mode=sandbox|live`, `GET /orders/:id`
- `POST /orders/sandbox` — тело ниже; заголовок `Idempotency-Key` обязателен.
- `POST /orders/:id/action`: `{ revision, action, reason }`; только sandbox.
- `GET /reports?from=YYYY-MM-DD&to=YYYY-MM-DD&mode=sandbox|live&brandId=...&format=json|csv`
- `GET /users`, `POST /users`: `{ name, email, role, password }`
- `PATCH /users/:id`: `{ active }`
- `GET /audit`
- `GET|POST /invoices` (создание только оператором): `{ period: "YYYY-MM" }`
- `POST /invoices/:id/paid` (только оператор): `{ reference }`
- `POST /integrations`: `{ provider: "iiko", brandId, apiLogin }` либо `{ provider: "tbank", brandId, terminalKey, password }`. Секреты не возвращаются.
- `POST /integrations/:brand/check-iiko` — проверка организаций.
- `POST /integrations/:brand/menu-preview` — получение снимка внешнего меню без публикации.

Точные поля настроек и их валидация: `src/schemas.js`. Роли и проверки — `src/admin.js`.

## Мобильные клиенты

Префикс `/api/public/:tenant`. Tenant — публичный идентификатор бизнеса в сборке приложения, не секрет авторизации.

- `GET /config` — активные бренды, точки (включая условия доставки), включённые способы оплаты, опубликованное оформление, `liveOrdersAvailable: false`.
- `GET /menu/:branch` — пока только демонстрационное меню.
- `POST /quote` — предварительный расчёт; не резервирует товар, бонусы или стоимость.
- `POST /auth/call`: `{ phone }` → `{ challengeId, proof, callTo, expiresIn }`.
- `POST /auth/call/status`: `{ challengeId, proof }` → `waiting` либо `{ status: "authenticated", token, expiresIn }`. Ограничивать частоту опроса (например, раз в 5 секунд), прекращать после тайм-аута. Token хранить в Keychain/Android Keystore, не в общей публичной конфигурации.
- После входа `Authorization: Bearer <token>`: `GET /orders`, `GET /loyalty`, `POST /auth/logout`.
- `POST /orders` пока отвечает 503 после проверки сессии. Не показывать успешный заказ при таком ответе.

Тело расчёта / sandbox-заказа:

```json
{
  "brandId": "unagi-1",
  "branchId": "point-1",
  "methodId": "unagi-1-cash",
  "mode": "pickup",
  "items": [{ "productId": "point-1-philadelphia", "quantity": 2 }],
  "requestedBonus": 0,
  "promoCode": "",
  "address": "",
  "comment": "",
  "table": ""
}
```

Цены клиента не принимаются. Корзина одной точки. Для доставки требуется адрес и минимум заказа; для зала — стол; для `scheduledAt` — разрешённый предзаказ и будущее время. Применение бонусов/промокода закрыто до расчёта iikoCard. Постоянный локальный demo-ID товара не заменяет UUID реального товара iiko.

CORS для удалённых WebView ещё не настроен: при подключении мобильной оболочки нужны точный список origin и защищённый сетевой слой. Не разрешать все origin для административных cookies.
