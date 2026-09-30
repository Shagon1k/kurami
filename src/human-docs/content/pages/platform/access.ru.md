---
title: Внешний доступ
nav: Доступ
summary: Как сайты Kurami становятся доступны тебе снаружи и никому больше: туннель, Cloudflare Access, локальные порты, превью через Caddy и что настраивается не в репозитории.
section: platform
group: guide
order: 80
next: docs-process
---

К сайтам Kurami ведёт один путь: Cloudflare Tunnel доставляет запрос на сервер, Cloudflare Access сначала проверяет, что это ты, и только потом запрос доходит до локального порта. Сами сервисы ничего не проверяют — они слушают `127.0.0.1` и считают, что до них дошёл уже проверенный запрос. Анонимный посетитель получает перенаправление на вход Access и до сервиса не добирается.

```diagram
kind: graph
title: Путь запроса снаружи
desc: Запрос идёт через Cloudflare Access и туннель к локальным портам сервера. Сайты Digest, документации и Hub слушают напрямую. Превью идут через Caddy, который открывает маршрут только для работающего превью.
node you "Ты" "браузер" owner at 0,0
node access "Cloudflare Access" "вход по личности" external at 1,0
node tunnel "Cloudflare Tunnel" "маршрут на сервер" external at 2,0
node digest "Digest" "127.0.0.1:8787" at 0,2
node docs "Документация" "127.0.0.1:8799" at 1,2
node hub "Hub" "127.0.0.1:8800" at 2,2
node caddy "Caddy" "127.0.0.1:9180" at 1,3
node preview "Превью" "порт на запуск" at 1,4
group vps "Сервер" digest docs hub caddy preview
edge you -> access "HTTPS"
edge access -> tunnel "разрешено"
edge tunnel -> digest
edge tunnel -> docs
edge tunnel -> hub
edge tunnel -> caddy
edge caddy -> preview "только работающие"
```

## Что где доступно

| Что | Порт на сервере | Защита |
|---|---|---|
| Digest | `127.0.0.1:8787` | Cloudflare Access |
| Эта документация, `docs.shagon1k.win` | `127.0.0.1:8799` | Cloudflare Access; `/` перенаправляет на `/en/` |
| Hub | `127.0.0.1:8800` | Cloudflare Access |
| Превью проектов, `preview-N.shagon1k.win` (N от 1 до 6) | через Caddy, `127.0.0.1:9180` | Cloudflare Access плюс ответ 404 для любого адреса без работающего превью |
| Ссылка «Open in Codex» | через Caddy | без Access: переход по точному идентификатору задачи |

## Превью через Caddy

Превью получают адрес вида `preview-N.shagon1k.win` по номеру слота. Caddy — отдельный сервис `kurami-preview-ingress`: он слушает `127.0.0.1:9180`, а список маршрутов собирает Project Orchestrator в файл `state/caddy/routes.caddy` по базе аренд. Маршрут есть только у превью в состоянии «работает»; на любой другой адрес Caddy отвечает 404 «no active route». Перед применением новой конфигурации Caddy проверяет её, а при сбое возвращает прежнюю. Подробнее о слотах и аренде — [Превью](@previews).

## Ссылка в приложение Codex

Discord принимает в кнопках-ссылках только HTTP(S), а Codex открывается по адресу `codex://`. Поэтому кнопка ведёт на узкий переходник в том же Caddy: он принимает только путь с точным UUID задачи и отвечает перенаправлением на `codex://threads/<uuid>`. Этот маршрут намеренно не закрыт Access: он не несёт данных, а приложение Codex проверяет твою сессию само.

## Чего в репозитории нет

Настройки Cloudflare — маршруты туннеля для `preview-1…6`, политики Access, служебный токен для автоматической проверки документации — лежат в панели Cloudflare. Репозиторий этого не проверяет и не меняет; для восстановления сервера их нужно создать вручную ([Восстановление](@recovery)). Тот факт, что анонимный запрос к адресу получает перенаправление на вход, проверяется по факту, но правила «кого пускать» из репозитория не видны. Для Hub эта зависимость самая важная: без Access страница открыта всем, кто дошёл до порта.

:::code-map
- `deploy/systemd/kurami-preview-ingress.service` — сервис Caddy
- `deploy/config/Caddyfile` — настройки Caddy: локальный адрес, импорт маршрутов
- `src/orchestrator/projects/previews/ingress.ts` — сборка маршрутов по арендам
- `src/human-docs/server.ts` — сервер документации, только GET и HEAD
- `src/hub/server.ts` — сервер Hub на `127.0.0.1`
:::
