# lightborn-dataset

Монорепо ассетов Lightborn: каталоги JSON, S3-ключи, admin API/UI, MCP, chrome-extension.

## Пакеты

- `@l-fight/dataset` — leaf: generated JSON + helpers (`imgAssetKey`, prompts, …)
- `@l-fight/dataset-api` — Nest admin API (port 3006)
- `@l-fight/dataset-ui` — Vite admin UI (`/dataset/`, port 3005)
- `@l-fight/dataset-mcp` — MCP search по каталогам
- `chrome-extension` — Gemini → dataset-ui

## Контракт ID

Игровые репозитории (Lightborn) ссылаются на стабильные asset id (`g****`, `s****`, `m****`, npc/avatar/location/background).  
Этот репозиторий обязан держать каталоги и объекты в S3 (`lfm`) в рабочем состоянии. Полные JSON в публичный S3 не публикуем.

## Dev

```bash
pnpm install
pnpm --filter @l-fight/dataset build
pnpm dev
```
