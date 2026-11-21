# OpenCode Pocket

Небольшой iPhone-клиент для [OpenCode](https://opencode.ai) 2.x: смотреть сессии на компьютере, отправлять промпты, подтверждать разрешения и получать push, когда агент закончил или ждёт ответа.

Это не официальное приложение OpenCode. Оно работает поверх публичного HTTP API OpenCode (`/api/*`) и проверено на OpenCode 2.3.x.

## Что умеет

- Подключение к серверу по одноразовой ссылке из `opencode pair` (вставка или сканирование QR) либо вручную по URL + паролю.
- Список сессий с поиском, автообновлением и индикатором «работает».
- Чат: текст ассистента, компактные строки инструментов, остановка выполнения.
- Подтверждение запросов разрешений (`Разрешить` / `Всегда` / `Отклонить`).
- Новая сессия в последней используемой папке.
- Push через Expo: «готово», «нужно подтверждение», «ошибка».
- Пароль сервера хранится в iOS Keychain (SecureStore).

## Структура

```
App.tsx                  навигация и состояние
src/api.ts               клиент OpenCode API, pairing
src/push.ts              Expo push + подписка на релей
src/screens/             Connect / Sessions / Chat / Settings
relay/relay.mjs          Node-релей: события OpenCode → Expo Push
```

## 1. Быстрый запуск (Expo Go)

На компьютере:

```sh
cd opencode-pocket
npm install
npx expo start
```

На iPhone установите **Expo Go** и отсканируйте QR из терминала. Камера и SecureStore в Expo Go работают. Удалённые пуши в Expo Go на iOS могут не регистрироваться — для них нужна сборка (шаг 4).

### Подключение к OpenCode

Сервер должен быть доступен с телефона по локальной сети:

```sh
opencode service set hostname 0.0.0.0
opencode service restart
opencode service status        # покажет адрес и порт
```

Затем создайте одноразовую ссылку и отсканируйте её в приложении:

```sh
opencode pair
```

Ссылка живёт 5 минут и срабатывает один раз. Если в ссылке `127.0.0.1`, телефон её не откроет — включите `hostname 0.0.0.0` или сформируйте ссылку с внешним адресом:

```sh
opencode pair --url http://192.168.1.20:4096
```

Можно не использовать pairing, а ввести URL и пароль вручную (вкладка «URL + пароль»). Пароль — тот, что задан через `opencode service set password …`.

## 2. Уведомления: релей

Приложению неоткуда знать о событиях, когда оно закрыто. Рядом с OpenCode запускается релей: он слушает SSE-поток `/api/event` и отправляет уведомления в один или несколько каналов:

| Канал | Платный Apple Developer | Куда приходит |
|---|---|---|
| Expo Push | **да** | в само приложение OpenCode Pocket |
| Telegram | нет | в Telegram |
| ntfy | нет | в приложение ntfy |

Если ставите unsigned IPA с бесплатным Apple ID — **Expo Push невозможен**, выбирайте Telegram или ntfy.

```sh
cd opencode-pocket/relay
cp relay.config.example.json relay.config.json
```

Заполните `relay.config.json` (нужные каналы, лишние оставьте пустыми):

```json
{
  "opencodeUrl": "http://127.0.0.1:28894",
  "username": "opencode",
  "password": "ваш-пароль-сервера",
  "port": 8787,
  "relayToken": "",
  "notify": { "idle": true, "permission": true, "failure": true },
  "telegram": { "token": "", "chatId": "" },
  "ntfy": { "topic": "", "url": "https://ntfy.sh", "token": "" }
}
```

`opencodeUrl` — адрес из `opencode service status` (релей ходит туда с компьютера). Запуск:

```sh
node relay.mjs
```

Проверка: `curl http://127.0.0.1:8787/health` — покажет `streamConnected`, число подписок и включённые каналы. Тест: `curl -X POST http://127.0.0.1:8787/test`.

### Telegram (бесплатно)

1. В Telegram напишите **@BotFather** → `/newbot` → получите токен.
2. Напишите своему боту любое сообщение.
3. Откройте `https://api.telegram.org/bot<ТОКЕН>/getUpdates` и возьмите `chat.id`.
4. Впишите `telegram.token` и `telegram.chatId`, перезапустите релей.

### ntfy (бесплатно)

1. Установите **ntfy** из App Store, подпишитесь на тему, например `opencode-pocket-8f3a91`.
2. Впишите её в `ntfy.topic` (имя темы — это фактически пароль, выбирайте случайное).
3. Перезапустите релей и нажмите тест.

### Expo Push (только с платным Apple Developer)

В приложении: **⚙ → Push-уведомления → адрес релея** `http://IP-компьютера:8787` → «Включить». Появится Expo push token, релей получит подписку. Кнопка «Отправить тестовый пуш» проверяет цепочку.

`relayToken` — необязательный общий секрет: если задан, приложение должно отправить его в заголовке `X-Relay-Token`. Не выставляйте релей в интернет без него.

## 3. Как это работает

- Pairing: `POST /api/pair` или ссылка из `opencode pair` → `GET /auth/connect/<code>` с `Accept: application/json` → `{ token }`. Токен используется как пароль Basic-аутентификации (`opencode:<token>`).
- Сессии: `GET /api/session`, `GET /api/session/{id}/message`, `POST /api/session/{id}/prompt`, `POST .../interrupt`.
- Разрешения: `GET /api/session/{id}/permission`, `POST .../permission/{requestID}/reply` с `{ decision: "once" | "always" | "reject" }`.
- Push: релей подписан на `session.idle`, `permission.asked`, `session.execution.failed`; заголовок — название сессии, текст — последний ответ или ошибка.

## 4. Сборка IPA и Sideloadly

### Вариант A. Без платного Apple Developer account (unsigned IPA)

EAS не умеет подписывать сборки бесплатным Apple ID, поэтому IPA собирается без подписи на macOS-раннере GitHub, а подписывает его Sideloadly.

1. Загрузите проект в GitHub (репозиторий может быть приватным):

   ```powershell
   cd "C:\Users\danik\Documents\Проект по умолчанию\opencode-pocket"
   git config user.name "Ваше Имя"
   git config user.email "you@example.com"
   git add .
   git commit -m "OpenCode Pocket"
   git branch -M main
   ```

   Создайте на github.com пустой репозиторий (без README), затем:

   ```powershell
   git remote add origin https://github.com/<ваш-логин>/opencode-pocket.git
   git push -u origin main
   ```

   Для входа GitHub попросит Personal Access Token или откроет браузер (Git Credential Manager).

2. В GitHub откройте **Actions → Build unsigned iOS IPA → Run workflow**.
3. Дождитесь окончания (10–20 минут), скачайте артефакт **OpenCodePocket-unsigned-ipa** и распакуйте `.ipa`.
4. Sideloadly: подключите iPhone по USB, перетащите `.ipa`, введите бесплатный Apple ID, установите.

Ограничения бесплатной подписи:

- сертификат живёт 7 дней — потом нужно переподписать и переустановить;
- одновременно можно держать 3 sideload-приложения;
- **push-уведомления не работают**: entitlement `aps-environment` недоступен бесплатному Apple ID. В приложении они просто не включатся;
- если сборка не встаёт из-за лимита приложений/подписей — удалите старые приложения, подписанные тем же Apple ID.

Примечания по GitHub Actions:

- workflow запускается только вручную (`workflow_dispatch`), чтобы не тратить минуты;
- сборка идёт на раннере `xcode-27`: Expo SDK 58 собирается с iOS 27 SDK, на старых macOS-образах с Xcode 16 сборка не пройдёт;
- у публичных репозиториев стандартные раннеры бесплатны; у приватных macOS-раннер расходует квоту с коэффициентом ×10 (2000 минут/мес ≈ 10–20 таких сборок);
- артефакт хранится 30 дней;
- если GitHub пишет `The job was not acquired by Runner...`, это нехватка capacity на стороне GitHub — просто запустите workflow ещё раз.

### Вариант B. Платный Apple Developer account ($99/год)

Нужен для настоящих APNs-пушей.

```sh
npm install -g eas-cli
eas login
cd opencode-pocket
eas init                 # добавит extra.eas.projectId в app.json
eas credentials          # iOS: Push Notifications key / сертификат
eas build -p ios --profile preview
```

EAS выдаст ссылку на `.ipa`. Дальше — Sideloadly.

Важно:

- Удалённые пуши на iOS работают только с платным Apple Developer account: бесплатный Apple ID не даёт entitlement `aps-environment`.
- Bundle ID (`app.opencodepocket.client`) должен совпадать с App ID, для которого включены Push Notifications.
- После `eas init` пересоберите приложение: `projectId` нужен для `getExpoPushTokenAsync`.
- `preview` — internal/ad-hoc профиль. Если Sideloadly переподписывает IPA своим профилем, убедитесь, что в нём есть push-entitlement.

## Ограничения

- Только OpenCode 2.x (используется новый API).
- Нет вложений, выбора модели/агента, терминала и диффов — это осознанно маленький пульт.
- Опрос сообщений идёт каждые ~1.8 с (без SSE в приложении), чтобы не усложнять клиент.
- Релей должен быть запущен, пока вы ждёте уведомления.

## Troubleshooting

- **«Сервер не отвечает»** — проверьте `opencode service status`, `hostname 0.0.0.0`, что телефон в той же сети и порт не блокирует firewall Windows. Для доступа извне используйте Tailscale/Cloudflare Tunnel, а не проброс порта в интернет.
- **Ссылка pairing просрочена** — `opencode pair` заново (5 минут, один раз).
- **Пуш не приходит** — `curl http://IP:8787/health` показывает `streamConnected: true` и число подписок; в настройках iOS разрешены уведомления; сборка standalone, а не Expo Go; тестовый пуш возвращает `ok`.
- **`DeviceNotRegistered`** — токен устарел (переустановка приложения); нажмите «Обновить» в настройках.
