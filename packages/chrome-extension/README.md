# @l-fight/chrome-extension

Chrome MV3 «L-Fight Admin Autofill»: автогенерация ассетов для админки.

- **Gemini → локации** (`/dataset/map-locations`) — full-size download → upload
- **Gemini → иконки** (`/dataset/game-icons`) — «Копировать изображение» → сырой буфер `All-raw` → автоцикл

## Установка

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked**
2. Указать папку `packages/chrome-extension`
3. Dataset UI на `http://localhost:3005/dataset/`, чат Gemini уже открыт/доступен

## Gemini → локации

1. В админке выбрать локацию с промптом
2. Нажать **Gemini генерация**
3. Расширение: **«Изменить» у верхнего user-query** (подтверждение edit-mode) → замена текста → «Обновить» (паузы ~0.5 с между фазами) → картинка → **Скачать в полном размере** (перехват blob в **MAIN world**; fallback https download URL) → вкладка админки → upload. Во время цикла — окно логов (закрывается по завершению). Если edit-mode не открылся / текст не заменился (до 3 попыток), «Обновить» залип или картинка не появилась за `WAIT_GEN_MS` (4 мин) — reload чата и повтор (до 2 reload).

Фиксированный чат: `https://gemini.google.com/app/44ed1351aab8bed6?dest=create`

Буфер для локаций **не** используется (copy даёт уменьшенный кадр).

## Gemini → иконки (автоцикл ×1)

1. Открыть `/dataset/game-icons`, выбрать первую иконку с промптом (удобно с фильтром «Ещё не обновлены…»)
2. В левом нижнем углу панели расширения:
   - **Gemini ×1 автоцикл** (зелёная) — пока есть промпты
   - **Gemini 1 раз** (жёлтая) — один цикл текущей иконки, без следующей
   - **изменить** (синяя) — локальная 512 в буфер → выбранный чат → вставка в продолжение + текст «Для этого изображения » (отправку не жмёт). После вашей отправки ждёт новую картинку и сохраняет её в админку (All-raw + 512, без следующей иконки)
3. Модалка: URL чата Gemini (prefill из `localStorage`, история дата+ссылка; повтор той же ссылки в историю не пишется)
4. Цикл: промпт → Gemini edit/gen → **«Копировать изображение»** → `l-fight-admin-save-raw-image` → PNG в `All-raw` **и сразу** apply в `All-512-new` (pending); raw остаётся для ручного «Кроп из сырого буфера». Автоцикл → следующая иконка; «1 раз» — стоп
5. **Стоп** — прервать цикл

Ручной перекроп из сырого буфера — в админке: «Кроп из сырого буфера» / «В 512 из сырого буфера».

После правок JS: поднять `version` в `manifest.json` (+ `package.json`) → Chrome → расширения → Reload у «L-Fight Admin Autofill».

## Структура

- `background.js` — оркестрация (локации + автоцикл иконок) + перехват `chrome.downloads`
- `content/admin.js` — мост с админкой + панель автоцикла на game-icons
- `content/gemini.js` — DOM Gemini (edit / download / copy)
- `shared.js` — helpers (JPEG transcode, clipboard fingerprint, log panel)
