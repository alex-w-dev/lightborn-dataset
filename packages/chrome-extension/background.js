const GEMINI_CHAT_URL =
  "https://gemini.google.com/app/44ed1351aab8bed6?dest=create";
const GEMINI_NEW_CHAT_URL = "https://gemini.google.com/app";
const ADMIN_MAP_URL_PATTERNS = [
  "http://localhost:3005/dataset/map-locations*",
  "http://127.0.0.1:3005/dataset/map-locations*",
];
const ADMIN_ICONS_URL_PATTERNS = [
  "http://localhost:3005/dataset/game-icons*",
  "http://127.0.0.1:3005/dataset/game-icons*",
];
const ADMIN_RETOUCH_URL_PATTERNS = [
  "http://localhost:3005/dataset/icon-retouch*",
  "http://127.0.0.1:3005/dataset/icon-retouch*",
];

let running = false;
let stopRequested = false;
let retryStepRequested = false;
let stepEpoch = 0;

function isStepRetry(err) {
  return /^STEP_RETRY\b/.test(err?.message || String(err || ""));
}

function sleep(ms) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (retryStepRequested) {
        reject(new Error("STEP_RETRY"));
        return;
      }
      const left = ms - (Date.now() - start);
      if (left <= 0) {
        resolve();
        return;
      }
      setTimeout(tick, Math.min(200, left));
    };
    tick();
  });
}

/** Сбросить ручной повтор перед новым шагом. */
async function beginStep() {
  retryStepRequested = false;
  const epoch = ++stepEpoch;
  const tabs = await chrome.tabs.query({
    url: [
      "https://gemini.google.com/*",
      "http://localhost:3005/dataset/*",
      "http://127.0.0.1:3005/dataset/*",
    ],
  });
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "ARM_STEP", epoch });
      } catch {
        /* вкладка без content script */
      }
    }),
  );
}

async function requestStepRetry() {
  if (!running) return { ok: true, idle: true };
  retryStepRequested = true;
  const epoch = ++stepEpoch;
  const tabs = await chrome.tabs.query({
    url: [
      "https://gemini.google.com/*",
      "http://localhost:3005/dataset/*",
      "http://127.0.0.1:3005/dataset/*",
    ],
  });
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "ABORT_STEP", epoch });
      } catch {
        /* вкладка без content script */
      }
    }),
  );
  return { ok: true };
}

function normalizeGeminiChatUrl(url) {
  const u = String(url || "").trim();
  if (!u) throw new Error("Укажите URL чата Gemini");
  if (!/^https:\/\/gemini\.google\.com\//i.test(u)) {
    throw new Error("URL должен начинаться с https://gemini.google.com/");
  }
  return u;
}

function geminiAppIdFromUrl(url) {
  const m = String(url || "").match(/gemini\.google\.com\/app\/([^/?#]+)/i);
  return m?.[1] || null;
}

async function findTab(urlPatterns) {
  for (const pattern of urlPatterns) {
    const tabs = await chrome.tabs.query({ url: pattern });
    if (tabs[0]) return tabs[0];
  }
  return null;
}

/** Открыть/переключить вкладку Gemini на нужный чат (по умолчанию — дефолтный URL). */
async function ensureGeminiTab(chatUrl) {
  const target = normalizeGeminiChatUrl(chatUrl || GEMINI_CHAT_URL);
  const appId = geminiAppIdFromUrl(target);
  const patterns = appId
    ? [
        `https://gemini.google.com/app/${appId}*`,
        `https://gemini.google.com/app/${appId}/*`,
      ]
    : ["https://gemini.google.com/app/*", "https://gemini.google.com/*"];

  let existing = await findTab(patterns);
  if (!existing && appId) {
    existing = await findTab([
      "https://gemini.google.com/app/*",
      "https://gemini.google.com/*",
    ]);
  }

  if (existing?.id) {
    const sameChat =
      appId && String(existing.url || "").includes(`/app/${appId}`);
    await chrome.tabs.update(existing.id, {
      active: true,
      url: sameChat ? undefined : target,
    });
    return existing;
  }
  return chrome.tabs.create({ url: target, active: true });
}

async function focusGeminiNewChat(adminTabId) {
  let tab = await findTab([
    "https://gemini.google.com/app/*",
    "https://gemini.google.com/*",
  ]);
  if (!tab?.id) {
    tab = await chrome.tabs.create({
      url: GEMINI_NEW_CHAT_URL,
      active: true,
    });
    await waitTabReady(tab.id, 45000);
    await sleep(800);
    return tab;
  }
  await chrome.tabs.update(tab.id, { active: true });
  await waitTabReady(tab.id, 20000);
  try {
    await send(tab.id, { type: "CLICK_NEW_CHAT" });
  } catch (err) {
    await logTo(
      adminTabId,
      `«Новый чат»: ${err?.message || err}`,
      true,
    );
    await waitTabReady(tab.id, 30000);
  }
  await sleep(400);
  return chrome.tabs.get(tab.id);
}

async function ensureAdminTab(
  preferredTabId,
  urlPatterns = ADMIN_MAP_URL_PATTERNS,
  missingMsg = "Откройте вкладку dataset /dataset/map-locations",
) {
  if (preferredTabId) {
    try {
      const tab = await chrome.tabs.get(preferredTabId);
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { active: true });
        return tab;
      }
    } catch {
      /* fallthrough */
    }
  }
  const existing = await findTab(urlPatterns);
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    return existing;
  }
  throw new Error(missingMsg);
}

async function setAdminBusy(adminTabId, busy) {
  try {
    await chrome.tabs.sendMessage(adminTabId, { type: "SET_BUSY", busy });
  } catch {
    /* ignore */
  }
}

async function clearAdminErrors(adminTabId) {
  try {
    await chrome.tabs.sendMessage(adminTabId, { type: "CLEAR_ERRORS" });
  } catch {
    /* ignore */
  }
}

/** Иконки: картинка не появилась — полный повтор шага с чтения промпта. */
const ICON_WAIT_IMAGE_MS = 120000;

function isRetryableGenerationError(err) {
  const msg = err?.message || String(err || "");
  return /GENERATION_FAILED|NEED_PAGE_RELOAD|RESTART_CYCLE|таймаут|не появил|не загрузил|не новая|не изменил|исходная картинка|Обновить|Отправить|Повторить|edit-box|Копировать|пропала из нового чата|всё ещё в поле/i.test(
    msg,
  );
}

/** Залипший чат Gemini перед повтором шага с промпта. Ошибка применения — нет. */
function geminiPageShouldReload(err) {
  const msg = err?.message || String(err || "");
  if (/^PASTE_FAILED\b|^PASTE_STOP\b/i.test(msg)) return false;
  return isRetryableGenerationError(err);
}

function needsGeminiPageReload(err) {
  const msg = err?.message || String(err || "");
  return /NEED_PAGE_RELOAD|Обновить» не сработал|клик «Обновить» не|edit-mode не открыл|не удалось заменить текст/i.test(
    msg,
  );
}

/** Полный reload вкладки Gemini + ожидание content script. */
async function reloadGeminiTab(tabId, adminTabId) {
  await logBoth(adminTabId, tabId, "Перезагружаю вкладку Gemini…", true);
  await chrome.tabs.reload(tabId);
  await waitTabReady(tabId, 45000);
  await openLogs(adminTabId, tabId);
  // После hard reload Angular/Quill долго поднимаются.
  await sleep(2200);
}

/**
 * EDIT_AND_GENERATE с reload страницы, если:
 * — не открылся edit-mode / текст не заменился / «Обновить» залип
 * — картинка не появилась за таймаут.
 * maxReloads — сколько раз перезагрузить и повторить (помимо первой попытки).
 */
async function sendEditAndGenerateWithReload(
  adminTabId,
  geminiTabId,
  prompt,
  maxReloads = 2,
  options = {},
) {
  let lastErr = null;
  for (let reload = 0; reload <= maxReloads; reload++) {
    try {
      if (reload > 0) {
        await reloadGeminiTab(geminiTabId, adminTabId);
        await logBoth(
          adminTabId,
          geminiTabId,
          `Повтор после reload (${reload}/${maxReloads})…`,
        );
        await sleep(800);
      }
      return await send(geminiTabId, {
        type: "EDIT_AND_GENERATE",
        prompt,
        waitMs: options.waitMs,
        imageTimeout: options.imageTimeout,
      });
    } catch (err) {
      lastErr = err;
      if (isStepRetry(err)) throw err;
      if (/^RESTART_CYCLE\b/.test(err?.message || String(err || ""))) throw err;
      if (!needsGeminiPageReload(err) || reload >= maxReloads) throw err;
      await logBoth(
        adminTabId,
        geminiTabId,
        `${err?.message || err} → reload страницы`,
        true,
      );
    }
  }
  throw lastErr || new Error("EDIT_AND_GENERATE failed");
}

function isPolicySkipError(err) {
  const msg = err?.message || String(err || "");
  return /POLICY_SKIP|модерац|не соответств|наруш|blocked|safety/i.test(msg);
}

function waitTabReady(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") {
          try {
            const res = await chrome.tabs.sendMessage(tabId, { type: "PING" });
            if (res?.ok) {
              resolve(tab);
              return;
            }
          } catch {
            /* not ready */
          }
        }
      } catch (err) {
        reject(err);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Вкладка не готова (content script)"));
        return;
      }
      setTimeout(tick, 300);
    };
    tick();
  });
}

async function send(tabId, msg) {
  await waitTabReady(tabId);
  const res = await chrome.tabs.sendMessage(tabId, msg);
  if (!res?.ok) throw new Error(res?.error || "Ошибка content script");
  return res;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Скачивание нового кадра с правами расширения, без CORS страницы Gemini. */
async function downloadGeneratedImage(url) {
  const target = String(url || "");
  if (!/^https?:\/\//i.test(target)) {
    throw new Error("У новой картинки нет https-адреса");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(target, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Скачивание новой картинки: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (!buf.byteLength) throw new Error("Пустой файл новой картинки");
    return {
      imageBase64: bytesToBase64(new Uint8Array(buf)),
      mime: res.headers.get("content-type") || "image/jpeg",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function logTo(tabId, text, error = false) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "LOG", text, error });
  } catch {
    /* вкладка без content script / sleep */
  }
}

async function logBoth(adminTabId, geminiTabId, text, error = false) {
  await Promise.all([
    logTo(adminTabId, text, error),
    logTo(geminiTabId, text, error),
  ]);
}

async function openLogs(adminTabId, geminiTabId) {
  const title = "L-Fight Autofill · Gemini";
  for (const id of [adminTabId, geminiTabId]) {
    if (!id) continue;
    try {
      await chrome.tabs.sendMessage(id, { type: "LOG_OPEN", title });
    } catch {
      /* ignore */
    }
  }
}

async function closeLogs(adminTabId, geminiTabId, delayMs = 0) {
  for (const id of [adminTabId, geminiTabId]) {
    if (!id) continue;
    try {
      await chrome.tabs.sendMessage(id, { type: "LOG_CLOSE", delayMs });
    } catch {
      /* ignore */
    }
  }
}

function armDownloadWaiter(timeoutMs = 60000) {
  let settled = false;
  let timer = null;
  let resolveFn = () => {};
  let rejectFn = () => {};

  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const onCreated = (item) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveFn(item);
  };

  const cleanup = () => {
    chrome.downloads.onCreated.removeListener(onCreated);
    if (timer) clearTimeout(timer);
  };

  chrome.downloads.onCreated.addListener(onCreated);
  timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectFn(new Error("Таймаут ожидания скачивания full-size"));
  }, timeoutMs);

  return {
    promise,
    disarm: () => {
      if (settled) return;
      settled = true;
      cleanup();
    },
  };
}

function waitDownloadComplete(downloadId, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const onChanged = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === "complete") {
        chrome.downloads.onChanged.removeListener(onChanged);
        resolve(true);
        return;
      }
      if (delta.state?.current === "interrupted") {
        chrome.downloads.onChanged.removeListener(onChanged);
        reject(new Error("Скачивание прервано"));
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);

    const tick = async () => {
      try {
        const [item] = await chrome.downloads.search({ id: downloadId });
        if (item?.state === "complete") {
          chrome.downloads.onChanged.removeListener(onChanged);
          resolve(true);
          return;
        }
        if (item?.state === "interrupted") {
          chrome.downloads.onChanged.removeListener(onChanged);
          reject(new Error("Скачивание прервано"));
          return;
        }
      } catch {
        /* ignore */
      }
      if (retryStepRequested) {
        chrome.downloads.onChanged.removeListener(onChanged);
        reject(new Error("STEP_RETRY"));
        return;
      }
      if (Date.now() - start > timeoutMs) {
        chrome.downloads.onChanged.removeListener(onChanged);
        reject(new Error("Таймаут завершения скачивания"));
        return;
      }
      setTimeout(tick, 300);
    };
    tick();
  });
}

async function eraseDownload(downloadId) {
  try {
    await chrome.downloads.cancel(downloadId);
  } catch {
    /* maybe already finished */
  }
  try {
    await chrome.downloads.erase({ id: downloadId });
  } catch {
    /* ignore */
  }
}

async function fetchDownloadViaPage(geminiTabId, downloadItem) {
  const url = downloadItem?.finalUrl || downloadItem?.url || "";
  if (!url) throw new Error("У download нет url");
  if (String(url).startsWith("blob:")) {
    throw new Error("Download URL — blob:; MAIN capture обязателен");
  }
  return send(geminiTabId, { type: "FETCH_BLOB_URL", url });
}

/**
 * Патч URL.createObjectURL + fetch(a[href]) в MAIN world страницы Gemini.
 * Isolated content script не видит blob: страницы → «URL scheme blob is not supported».
 */
async function injectMainBlobCapture(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const SOURCE = "__LFIGHT_BLOB_CAP__";
      const FLAG = "__LFIGHT_BLOB_CAP_INSTALLED__";
      if (window[FLAG]) return;
      window[FLAG] = true;

      const sniff = (u8) => {
        if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
          return "image/jpeg";
        }
        if (
          u8.length >= 8 &&
          u8[0] === 0x89 &&
          u8[1] === 0x50 &&
          u8[2] === 0x4e &&
          u8[3] === 0x47
        ) {
          return "image/png";
        }
        if (
          u8.length >= 12 &&
          u8[0] === 0x52 &&
          u8[1] === 0x49 &&
          u8[2] === 0x46 &&
          u8[3] === 0x46 &&
          u8[8] === 0x57 &&
          u8[9] === 0x45 &&
          u8[10] === 0x42 &&
          u8[11] === 0x50
        ) {
          return "image/webp";
        }
        if (u8.length >= 12) {
          const brand = String.fromCharCode(u8[4], u8[5], u8[6], u8[7]);
          if (brand === "ftyp") {
            const rest = String.fromCharCode(
              ...u8.subarray(8, Math.min(24, u8.length)),
            );
            if (/avif|avis|mif1/i.test(rest)) return "image/avif";
          }
        }
        return null;
      };

      const toBase64 = (u8) => {
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < u8.length; i += chunk) {
          binary += String.fromCharCode(...u8.subarray(i, i + chunk));
        }
        return btoa(binary);
      };

      const postBlob = (blob, via) => {
        if (!blob || !blob.size || blob.size < 8_000) return;
        const type = blob.type || "";
        blob
          .arrayBuffer()
          .then((buf) => {
            const u8 = new Uint8Array(buf);
            const magic = sniff(u8);
            // Без magic пропускаем только крупные octet-stream (полный download).
            if (!magic && !(type.startsWith("image/") || blob.size > 40_000)) {
              return;
            }
            window.postMessage(
              {
                source: SOURCE,
                via,
                mime: magic || type || "application/octet-stream",
                size: blob.size,
                // base64 надёжнее ArrayBuffer через postMessage/SW.
                base64: toBase64(u8),
              },
              "*",
            );
          })
          .catch(() => {});
      };

      const origCreate = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (obj) => {
        const url = origCreate(obj);
        try {
          if (obj instanceof Blob) postBlob(obj, "createObjectURL");
        } catch {
          /* ignore */
        }
        return url;
      };

      document.addEventListener(
        "click",
        (ev) => {
          const a = ev.target?.closest?.("a[href]");
          if (!a) return;
          const href = a.href || a.getAttribute("href") || "";
          if (!href || href === "#" || href.startsWith("javascript:")) return;
          if (!href.startsWith("blob:") && !/^https?:/i.test(href)) return;
          // MAIN world может читать свой blob:; content script — нет.
          void fetch(href)
            .then((r) => (r.ok ? r.blob() : null))
            .then((b) => {
              if (b) postBlob(b, `anchor:${href.slice(0, 48)}`);
            })
            .catch(() => {});
        },
        true,
      );
    },
  });
}

async function runGeminiGenerate({ prompt, locationId, adminTabId }) {
  if (running) throw new Error("Уже идёт генерация");
  running = true;
  stopRequested = false;
  let downloadId = null;
  let admin = null;
  let gemini = null;
  try {
    for (;;) {
    try {
    await beginStep();
    admin = await ensureAdminTab(adminTabId);
    await openLogs(admin.id, null);
    await logBoth(admin.id, null, `Старт автоматизации: ${locationId || "?"}`);

    gemini = await ensureGeminiTab();
    await waitTabReady(gemini.id);
    await openLogs(admin.id, gemini.id);
    await logBoth(admin.id, gemini.id, "Вкладка Gemini готова");
    await sleep(700);

    try {
      await injectMainBlobCapture(gemini.id);
      await logBoth(admin.id, gemini.id, "MAIN blob capture установлен");
    } catch (injErr) {
      await logBoth(
        admin.id,
        gemini.id,
        `MAIN inject: ${injErr?.message || injErr}`,
        true,
      );
    }

    await logBoth(admin.id, gemini.id, "Правка верхнего запроса…");
    await sendEditAndGenerateWithReload(admin.id, gemini.id, prompt, 2);
    await sleep(700);
    await logBoth(admin.id, gemini.id, "Генерация завершена, скачиваю full-size…");

    // После генерации страница могла перерисовать — reinject на всякий случай.
    try {
      await injectMainBlobCapture(gemini.id);
    } catch {
      /* уже стоял / SPA */
    }

    const waiter = armDownloadWaiter(90000);
    let payload = null;
    try {
      payload = await send(gemini.id, { type: "CLICK_DOWNLOAD_FULL_CAPTURE" });
      waiter.disarm();
      await logBoth(
        admin.id,
        gemini.id,
        `Full-size перехвачен в странице (${payload.via || "blob"}, ${Math.round((payload.size || 0) / 1024)} KB)`,
      );
    } catch (captureErr) {
      await logBoth(
        admin.id,
        gemini.id,
        `Перехват blob не удался: ${captureErr?.message || captureErr} → downloads API`,
        true,
      );
      const created = await waiter.promise;
      downloadId = created.id;
      await logBoth(admin.id, gemini.id, `Download id=${downloadId}, жду complete…`);
      await waitDownloadComplete(downloadId, 90000);
      const [item] = await chrome.downloads.search({ id: downloadId });
      payload = await fetchDownloadViaPage(gemini.id, item || created);
      await logBoth(
        admin.id,
        gemini.id,
        `Full-size через URL download (${Math.round((payload.size || 0) / 1024)} KB)`,
      );
      await eraseDownload(downloadId);
      downloadId = null;
    }

    // На всякий случай подчистим свежий download, если файл всё же ушёл в Downloads.
    try {
      const recent = await chrome.downloads.search({
        orderBy: ["-startTime"],
        limit: 3,
      });
      const cutoff = Date.now() - 120000;
      for (const d of recent) {
        const t = Date.parse(d.startTime || "") || 0;
        if (t >= cutoff && /image|\.png|\.jpe?g|\.webp/i.test(`${d.filename} ${d.mime}`)) {
          await eraseDownload(d.id);
        }
      }
    } catch {
      /* ignore */
    }

    if (!payload?.imageBase64 && !payload?.imageBuffer) {
      throw new Error("Нет данных изображения после скачивания");
    }

    await logBoth(admin.id, gemini.id, "Переключаюсь на админку…");
    admin = await ensureAdminTab(admin.id);
    await waitTabReady(admin.id);
    await openLogs(admin.id, gemini.id);
    await logBoth(
      admin.id,
      gemini.id,
      `Upload ${Math.round((payload.size || 0) / 1024)} KB JPEG → map-locations`,
    );

    // Только base64 — ArrayBuffer через SW→tab часто ломается (sharp unsupported).
    await send(admin.id, {
      type: "UPLOAD_IMAGE",
      imageBase64: payload.imageBase64,
      mime: payload.mime || "image/jpeg",
    });

    await logBoth(admin.id, gemini.id, "Готово");
    await closeLogs(admin.id, gemini.id, 600);
    return { ok: true, locationId, size: payload.size };
    } catch (err) {
      if (isStepRetry(err) && !stopRequested) {
        await logBoth(
          admin?.id,
          gemini?.id,
          "Перезагрузка шага — повтор генерации…",
          true,
        );
        continue;
      }
      throw err;
    }
    }
  } catch (err) {
    const msg = err?.message || String(err);
    await logBoth(admin?.id, gemini?.id, msg, true);
    await closeLogs(admin?.id, gemini?.id, 5000);
    throw err;
  } finally {
    running = false;
  }
}

/**
 * Автоцикл иконок: GET_PROMPT → Gemini edit/gen → «Копировать изображение»
 * → SAVE_RAW (All-raw + apply в All-512-new/pending; raw для ручного кропа) → следующая.
 * options.maxIcons > 0 — остановиться после N успешных сохранений (1 = один цикл).
 * options.advance === false — не переходить к следующей иконке после SAVE_RAW.
 */
async function runGeminiIconAutoLoop(adminTabId, chatUrl, options = {}) {
  if (running) throw new Error("Уже идёт генерация");
  stopRequested = false;
  running = true;
  let count = 0;
  let retriesForCurrent = 0;
  const maxIcons =
    Number.isFinite(options.maxIcons) && options.maxIcons > 0
      ? Math.floor(options.maxIcons)
      : 0;
  const advanceAfterSave = options.advance !== false;
  let admin = null;
  let gemini = null;
  const geminiChatUrl = normalizeGeminiChatUrl(chatUrl || GEMINI_CHAT_URL);

  await setAdminBusy(adminTabId, true);
  try {
    admin = await ensureAdminTab(
      adminTabId,
      ADMIN_ICONS_URL_PATTERNS,
      "Откройте вкладку dataset /dataset/game-icons",
    );
    await openLogs(admin.id, null);
    await logTo(
      admin.id,
      maxIcons === 1
        ? "Gemini 1 раз (иконки)"
        : maxIcons > 1
          ? `Gemini ×${maxIcons} (иконки)`
          : "Автоцикл Gemini ×1 (иконки)",
    );
    await logTo(admin.id, `Чат: ${geminiChatUrl}`);

    while (!stopRequested) {
      let icon = "?";
      try {
      await beginStep();
      admin = await ensureAdminTab(
        admin.id,
        ADMIN_ICONS_URL_PATTERNS,
        "Откройте вкладку dataset /dataset/game-icons",
      );
      await clearAdminErrors(admin.id);
      await logTo(
        admin.id,
        count
          ? `Следующая иконка… (#${count + 1})`
          : retriesForCurrent
            ? `Повтор промпта… (${retriesForCurrent})`
            : "Читаю промпт…",
      );

      const promptRes = await send(admin.id, { type: "GET_PROMPT" });
      const prompt = promptRes?.prompt;
      icon = promptRes?.icon || "?";
      if (!prompt) break;

        await logTo(
          admin.id,
          retriesForCurrent
            ? `Повтор Gemini: ${icon} (${retriesForCurrent})`
            : `Gemini генерация: ${icon}`,
        );

        gemini = await ensureGeminiTab(geminiChatUrl);
        await waitTabReady(gemini.id);
        await openLogs(admin.id, gemini.id);
        await logBoth(admin.id, gemini.id, `Правка запроса: ${icon}`);
        // После activate вкладки Gemini нужен settle — иначе клик «Изменить»
        // / вставка в Quill иногда не срабатывают.
        await sleep(1600);

        await sendEditAndGenerateWithReload(admin.id, gemini.id, prompt, 2, {
          waitMs: ICON_WAIT_IMAGE_MS,
          imageTimeout: "restart",
        });
        if (stopRequested) break;

        await logBoth(
          admin.id,
          gemini.id,
          "Готово → «Копировать изображение»…",
        );
        await sleep(600);
        const copyRes = await send(gemini.id, {
          type: "CLICK_COPY_IMAGE_CAPTURE",
        });
        if (!copyRes?.imageBase64 || !copyRes?.fingerprint) {
          throw new Error("GENERATION_FAILED: нет image после Copy");
        }

        if (stopRequested) break;

        admin = await ensureAdminTab(
          admin.id,
          ADMIN_ICONS_URL_PATTERNS,
          "Откройте вкладку dataset /dataset/game-icons",
        );
        await waitTabReady(admin.id);
        await openLogs(admin.id, gemini.id);
        await logBoth(
          admin.id,
          gemini.id,
          `Буфер+512 ${icon} (${Math.round((copyRes.size || 0) / 1024)} KB)…`,
        );

        const pasteRes = await send(admin.id, {
          type: "SAVE_RAW",
          imageBase64: copyRes.imageBase64,
          mime: copyRes.mime || "image/jpeg",
          expectedFingerprint: copyRes.fingerprint,
          advance: advanceAfterSave,
        });
        if (stopRequested) break;
        if (!pasteRes?.ok) {
          throw new Error(
            `PASTE_FAILED: ${pasteRes?.error || "картинка не применилась"}`,
          );
        }

        count += 1;
        retriesForCurrent = 0;
        await clearAdminErrors(admin.id);
        await logBoth(admin.id, gemini.id, `Сохранено: ${icon} (#${count})`);

        if (maxIcons > 0 && count >= maxIcons) {
          await logBoth(
            admin.id,
            gemini.id,
            maxIcons === 1
              ? `Один цикл готов: ${icon}`
              : `Лимит ${maxIcons} достигнут (${count})`,
          );
          break;
        }
        if (pasteRes.done || !pasteRes.prompt) {
          await logBoth(admin.id, gemini.id, `Цикл завершён (${count})`);
          break;
        }
        if (!pasteRes.advanced && count > 0) {
          await logBoth(
            admin.id,
            gemini.id,
            `Стоп: не перешли к следующей (сделано ${count})`,
            true,
          );
          break;
        }
      } catch (err) {
        if (isStepRetry(err) && !stopRequested) {
          await logBoth(
            admin?.id,
            gemini?.id,
            "Перезагрузка шага — повтор генерации…",
            true,
          );
          continue;
        }
        const msg = err?.message || String(err);
        await ensureAdminTab(
          admin?.id,
          ADMIN_ICONS_URL_PATTERNS,
          "Откройте вкладку dataset /dataset/game-icons",
        ).catch(() => null);

        if (isPolicySkipError(err) && !stopRequested) {
          if (maxIcons === 1) {
            await logBoth(
              admin?.id,
              gemini?.id,
              `Модерация ${icon}: один цикл остановлен`,
              true,
            );
            break;
          }
          await logBoth(
            admin?.id,
            gemini?.id,
            `Пропуск ${icon}: модерация → следующая`,
            true,
          );
          const skipRes = await send(admin.id, { type: "SKIP_TO_NEXT" });
          retriesForCurrent = 0;
          if (skipRes?.done || !skipRes?.prompt || !skipRes?.advanced) {
            await logBoth(
              admin.id,
              gemini?.id,
              `Цикл завершён после пропуска (${count})`,
            );
            break;
          }
          await logBoth(admin.id, gemini?.id, `Пропущено → ${skipRes.icon}`);
          await sleep(400);
          continue;
        }

        if (stopRequested) break;
        retriesForCurrent += 1;
        await logBoth(
          admin?.id,
          gemini?.id,
          `Ошибка → цикл с промпта (${retriesForCurrent}): ${msg}`,
          true,
        );
        if (gemini?.id && geminiPageShouldReload(err)) {
          try {
            await reloadGeminiTab(gemini.id, admin?.id);
          } catch (reloadErr) {
            await logBoth(
              admin?.id,
              gemini?.id,
              `Reload Gemini: ${reloadErr?.message || reloadErr}`,
              true,
            );
          }
        }
        await sleep(800);
        continue;
      }
    }

    if (stopRequested) {
      await logBoth(admin?.id, gemini?.id, `Остановлено (сделано ${count})`);
    }
    await closeLogs(admin?.id, gemini?.id, 1200);
    return { ok: true, count };
  } catch (err) {
    const msg = err?.message || String(err);
    await logBoth(admin?.id, gemini?.id, msg, true);
    await closeLogs(admin?.id, gemini?.id, 5000);
    throw err;
  } finally {
    running = false;
    stopRequested = false;
    await setAdminBusy(adminTabId, false);
  }
}

/**
 * «Изменить»: локальная 512 → буфер → продолжение выбранного чата
 * + текст «Для этого изображения ». Отправку не жмём.
 * Когда появится новая картинка — тот же SAVE_RAW, без перехода к следующей.
 */
async function runGeminiIconAlter(adminTabId, chatUrl) {
  if (running) throw new Error("Уже идёт генерация");
  stopRequested = false;
  running = true;
  let admin = null;
  let gemini = null;
  const geminiChatUrl = normalizeGeminiChatUrl(chatUrl || GEMINI_CHAT_URL);
  const waitMs = 600000;

  await setAdminBusy(adminTabId, true);
  try {
    for (;;) {
    try {
    await beginStep();
    admin = await ensureAdminTab(
      adminTabId,
      ADMIN_ICONS_URL_PATTERNS,
      "Откройте вкладку dataset /dataset/game-icons",
    );
    await openLogs(admin.id, null);
    await logTo(admin.id, "Изменить: копирую локальную 512…");
    await logTo(admin.id, `Чат: ${geminiChatUrl}`);

    const local = await send(admin.id, { type: "GET_LOCAL_512" });
    const icon = local.icon || "?";
    if (!local.imageBase64) throw new Error("Нет данных локальной 512");

    gemini = await ensureGeminiTab(geminiChatUrl);
    await waitTabReady(gemini.id);
    await openLogs(admin.id, gemini.id);
    await logBoth(
      admin.id,
      gemini.id,
      `512 ${icon} (${Math.round((local.size || 0) / 1024)} KB) → продолжение чата`,
    );
    await sleep(1600);
    if (stopRequested) {
      await logBoth(admin.id, gemini.id, "Остановлено");
      await closeLogs(admin.id, gemini.id, 1200);
      return { ok: true, count: 0 };
    }

    const pasted = await send(gemini.id, {
      type: "PASTE_ICON_CONTINUE",
      imageBase64: local.imageBase64,
      mime: local.mime || "image/png",
      text: "Для этого изображения ",
    });
    const prevSrcs = pasted.srcs || [];
    await logBoth(
      admin.id,
      gemini.id,
      "Картинка и «Для этого изображения » в composer. Допишите и отправьте — жду новую картинку…",
    );

    const start = Date.now();
    let stable = 0;
    let ready = false;
    while (!stopRequested && Date.now() - start < waitMs) {
      const st = await send(gemini.id, {
        type: "POLL_NEW_IMAGE",
        prevSrcs,
      });
      if (st.ready) {
        stable += 1;
        if (stable >= 2) {
          ready = true;
          break;
        }
      } else {
        stable = 0;
      }
      await sleep(1000);
    }
    if (stopRequested) {
      await logBoth(admin.id, gemini.id, "Остановлено (жду генерацию)");
      await closeLogs(admin.id, gemini.id, 1200);
      return { ok: true, count: 0 };
    }
    if (!ready) {
      throw new Error("Таймаут: новая картинка после «изменить» не появилась");
    }

    await logBoth(admin.id, gemini.id, "Новая картинка готова → «Копировать изображение»…");
    await sleep(600);
    const copyRes = await send(gemini.id, {
      type: "CLICK_COPY_NEW_IMAGE",
      prevSrcs,
    });
    if (!copyRes?.imageBase64 || !copyRes?.fingerprint) {
      throw new Error("GENERATION_FAILED: нет image после Copy");
    }

    admin = await ensureAdminTab(
      admin.id,
      ADMIN_ICONS_URL_PATTERNS,
      "Откройте вкладку dataset /dataset/game-icons",
    );
    await waitTabReady(admin.id);
    await openLogs(admin.id, gemini.id);
    await logBoth(
      admin.id,
      gemini.id,
      `Буфер+512 ${icon} (${Math.round((copyRes.size || 0) / 1024)} KB)…`,
    );

    const saved = await send(admin.id, {
      type: "SAVE_RAW",
      imageBase64: copyRes.imageBase64,
      mime: copyRes.mime || "image/jpeg",
      expectedFingerprint: copyRes.fingerprint,
      advance: false,
    });
    if (!saved?.ok) {
      throw new Error(
        `PASTE_FAILED: ${saved?.error || "картинка не применилась"}`,
      );
    }

    await clearAdminErrors(admin.id);
    await logBoth(admin.id, gemini.id, `Сохранено после «изменить»: ${icon}`);
    await closeLogs(admin.id, gemini.id, 1200);
    return { ok: true, count: 1, icon };
    } catch (err) {
      if (stopRequested) {
        await logBoth(admin?.id, gemini?.id, "Остановлено");
        await closeLogs(admin?.id, gemini?.id, 1200);
        return { ok: true, count: 0 };
      }
      const msg = err?.message || String(err);
      await logBoth(
        admin?.id,
        gemini?.id,
        isStepRetry(err)
          ? "Перезагрузка шага — повтор «изменить»…"
          : `Ошибка → цикл «изменить» сначала: ${msg}`,
        true,
      );
      if (gemini?.id && geminiPageShouldReload(err)) {
        try {
          await reloadGeminiTab(gemini.id, admin?.id);
        } catch (reloadErr) {
          await logBoth(
            admin?.id,
            gemini?.id,
            `Reload Gemini: ${reloadErr?.message || reloadErr}`,
            true,
          );
        }
      }
      await sleep(800);
      continue;
    }
    }
  } catch (err) {
    const msg = err?.message || String(err);
    await logBoth(admin?.id, gemini?.id, msg, true);
    await closeLogs(admin?.id, gemini?.id, 5000);
    throw err;
  } finally {
    running = false;
    stopRequested = false;
    await setAdminBusy(adminTabId, false);
  }
}

/**
 * Доработка: S3 512 + общий промпт → новое сообщение Gemini →
 * All-raw-retouch и All-512-retouch → следующая иконка.
 */
async function runGeminiIconRetouchLoop(adminTabId, _chatUrl, options = {}) {
  if (running) throw new Error("Уже идёт генерация");
  stopRequested = false;
  running = true;
  let count = 0;
  let retriesForCurrent = 0;
  const maxIcons =
    Number.isFinite(options.maxIcons) && options.maxIcons > 0
      ? Math.floor(options.maxIcons)
      : 0;
  const advanceAfterSave = options.advance !== false;
  const waitMs = ICON_WAIT_IMAGE_MS;
  let admin = null;
  let gemini = null;
  const missingMsg = "Откройте вкладку dataset /dataset/icon-retouch";

  await setAdminBusy(adminTabId, true);
  try {
    admin = await ensureAdminTab(
      adminTabId,
      ADMIN_RETOUCH_URL_PATTERNS,
      missingMsg,
    );
    await openLogs(admin.id, null);
    await logTo(
      admin.id,
      maxIcons === 1 ? "Доработка 1 раз" : "Автоцикл доработки иконок",
    );
    await logTo(admin.id, "Новый чат: клик «Новый чат», без обновления страницы");

    while (!stopRequested) {
      let icon = "?";
      try {
      await beginStep();
      admin = await ensureAdminTab(admin.id, ADMIN_RETOUCH_URL_PATTERNS, missingMsg);
      await clearAdminErrors(admin.id);
      const promptRes = await send(admin.id, { type: "GET_PROMPT" });
      const prompt = promptRes?.prompt;
      icon = promptRes?.icon || "?";
      if (!prompt) break;

      const s3 = await send(admin.id, { type: "GET_S3_512" });
      if (!s3?.ok || !s3.imageBase64) {
        if (maxIcons === 1) {
          await logTo(admin.id, `Нет S3 у ${icon}: один цикл остановлен`, true);
          break;
        }
        await logTo(admin.id, `Пропуск ${icon}: нет S3 → следующая`, true);
        const skipRes = await send(admin.id, { type: "SKIP_RETOUCH" });
        retriesForCurrent = 0;
        if (skipRes?.done || !skipRes?.advanced) {
          await logTo(admin.id, `Цикл завершён после пропуска (${count})`);
          break;
        }
        await logTo(admin.id, `Пропущено → ${skipRes.icon}`);
        continue;
      }

        await logTo(admin.id, `Доработка Gemini: ${icon}`);
        gemini = await focusGeminiNewChat(admin.id);
        await openLogs(admin.id, gemini.id);
        await sleep(1600);
        if (stopRequested) break;

        let prevSrcs = [];
        try {
          const pasted = await send(gemini.id, {
            type: "PASTE_ICON_AND_SEND",
            imageBase64: s3.imageBase64,
            mime: s3.mime || "image/jpeg",
            text: prompt,
          });
          prevSrcs = pasted.srcs || [];
        } catch (sendErr) {
          const sendMsg = sendErr?.message || String(sendErr);
          if (!/Отправить/i.test(sendMsg)) throw sendErr;
          await logBoth(
            admin.id,
            gemini.id,
            `${sendMsg} — проверяю генерацию, как после «Обновить»`,
            true,
          );
          try {
            const snap = await send(gemini.id, {
              type: "SNAPSHOT_GENERATED_IMAGES",
            });
            prevSrcs = snap?.srcs || [];
          } catch {
            prevSrcs = [];
          }
        }

        const start = Date.now();
        let stable = 0;
        let ready = false;
        let brokenStreak = 0;
        let brokenRetries = 0;
        while (!stopRequested && Date.now() - start < waitMs) {
          const st = await send(gemini.id, {
            type: "POLL_NEW_IMAGE",
            prevSrcs,
          });
          if (st.ready) {
            brokenStreak = 0;
            stable += 1;
            if (stable >= 2) {
              ready = true;
              break;
            }
          } else if (st.broken && brokenRetries < 2) {
            stable = 0;
            brokenStreak += 1;
            if (brokenStreak >= 3) {
              brokenStreak = 0;
              brokenRetries += 1;
              await logBoth(
                admin.id,
                gemini.id,
                `Картинка не загрузилась — «Повторить» ${brokenRetries}/2`,
                true,
              );
              await send(gemini.id, { type: "RETRY_IMAGE_GENERATION" });
              if (st.brokenSrc) prevSrcs = [...prevSrcs, st.brokenSrc];
            }
          } else {
            stable = 0;
            brokenStreak = 0;
          }
          await sleep(1000);
        }
        if (stopRequested) break;
        if (!ready) {
          throw new Error("RESTART_CYCLE: новая картинка доработки не появилась");
        }

        await logBoth(
          admin.id,
          gemini.id,
          "Новая картинка готова → «Копировать изображение»…",
        );
        await sleep(600);
        const copyRes = await send(gemini.id, {
          type: "CLICK_COPY_NEW_IMAGE",
          prevSrcs,
        });
        if (!copyRes?.imageBase64 || !copyRes?.fingerprint) {
          throw new Error("GENERATION_FAILED: нет image после Copy");
        }

        admin = await ensureAdminTab(admin.id, ADMIN_RETOUCH_URL_PATTERNS, missingMsg);
        await waitTabReady(admin.id);
        await openLogs(admin.id, gemini.id);
        await logBoth(
          admin.id,
          gemini.id,
          `Буфер+512 ${icon} (${Math.round((copyRes.size || 0) / 1024)} KB)…`,
        );
        const pasteRes = await send(admin.id, {
          type: "SAVE_RETOUCH",
          imageBase64: copyRes.imageBase64,
          mime: copyRes.mime || "image/jpeg",
          expectedFingerprint: copyRes.fingerprint,
          advance: advanceAfterSave,
        });
        if (stopRequested) break;
        if (!pasteRes?.ok) {
          throw new Error(
            `PASTE_FAILED: ${pasteRes?.error || "картинка не применилась"}`,
          );
        }

        count += 1;
        retriesForCurrent = 0;
        await clearAdminErrors(admin.id);
        await logBoth(admin.id, gemini.id, `Сохранено и применено: ${icon} (#${count})`);

        if (maxIcons > 0 && count >= maxIcons) {
          await logBoth(admin.id, gemini.id, `Лимит ${maxIcons} достигнут (${count})`);
          break;
        }
        if (pasteRes.done || !advanceAfterSave) {
          await logBoth(admin.id, gemini.id, `Цикл завершён (${count})`);
          break;
        }
        if (!pasteRes.advanced && count > 0) {
          await logBoth(
            admin.id,
            gemini.id,
            `Стоп: не перешли к следующей (сделано ${count})`,
            true,
          );
          break;
        }
      } catch (err) {
        if (isStepRetry(err) && !stopRequested) {
          await logBoth(
            admin?.id,
            gemini?.id,
            "Перезагрузка шага — повтор генерации…",
            true,
          );
          continue;
        }
        if (stopRequested) break;
        const msg = err?.message || String(err);
        retriesForCurrent += 1;
        await logBoth(
          admin?.id,
          gemini?.id,
          `Ошибка → цикл с промпта (${retriesForCurrent}): ${msg}`,
          true,
        );
        if (gemini?.id && geminiPageShouldReload(err)) {
          try {
            await reloadGeminiTab(gemini.id, admin?.id);
          } catch (reloadErr) {
            await logBoth(
              admin?.id,
              gemini?.id,
              `Reload Gemini: ${reloadErr?.message || reloadErr}`,
              true,
            );
          }
        }
        await sleep(800);
        continue;
      }
    }

    if (stopRequested) {
      await logBoth(admin?.id, gemini?.id, `Остановлено (сделано ${count})`);
    }
    await closeLogs(admin?.id, gemini?.id, 1200);
    await ensureAdminTab(admin?.id, ADMIN_RETOUCH_URL_PATTERNS, missingMsg).catch(
      () => null,
    );
    return { ok: true, count };
  } catch (err) {
    const msg = err?.message || String(err);
    await ensureAdminTab(admin?.id, ADMIN_RETOUCH_URL_PATTERNS, missingMsg).catch(
      () => null,
    );
    try {
      if (admin?.id) {
        await send(admin.id, { type: "SHOW_RETOUCH_ERROR", error: msg });
      }
    } catch {
      /* страница без слушателя */
    }
    await logBoth(admin?.id, gemini?.id, msg, true);
    await closeLogs(admin?.id, gemini?.id, 5000);
    throw err;
  } finally {
    running = false;
    stopRequested = false;
    await setAdminBusy(adminTabId, false);
  }
}

const LOCATION_QUARTER_PROMPT =
  "Improve the image quality and sharpness. Keep the same composition, framing, and content. Do not add or remove objects.";

/** Четверть локации: новый чат Gemini, full-size обратно в админку. */
async function runGeminiLocationQuarter({
  imageBase64,
  mime,
  corner,
  prompt,
  adminTabId,
}) {
  if (running) throw new Error("Уже идёт генерация");
  if (!imageBase64) throw new Error("Нет изображения четверти");
  running = true;
  stopRequested = false;
  let downloadId = null;
  let admin = null;
  let gemini = null;
  try {
    admin = await ensureAdminTab(adminTabId);
    await openLogs(admin.id, null);
    await logBoth(admin.id, null, `Четверть ${corner || "?"}`);
    if (stopRequested) throw new Error("Остановлено");

    gemini = await focusGeminiNewChat(admin.id);
    await openLogs(admin.id, gemini.id);
    try {
      await injectMainBlobCapture(gemini.id);
    } catch (injErr) {
      await logBoth(
        admin.id,
        gemini.id,
        `MAIN inject: ${injErr?.message || injErr}`,
        true,
      );
    }
    if (stopRequested) throw new Error("Остановлено");

    const pasted = await send(gemini.id, {
      type: "PASTE_ICON_AND_SEND",
      imageBase64,
      mime: mime || "image/jpeg",
      text: String(prompt || LOCATION_QUARTER_PROMPT),
    });
    const prevSrcs = pasted.srcs || [];
    const start = Date.now();
    let stable = 0;
    let ready = false;
    while (!stopRequested && Date.now() - start < 120000) {
      const st = await send(gemini.id, { type: "POLL_NEW_IMAGE", prevSrcs });
      if (st.ready) {
        stable += 1;
        if (stable >= 2) {
          ready = true;
          break;
        }
      } else {
        stable = 0;
      }
      await sleep(1000);
    }
    if (stopRequested) throw new Error("Остановлено");
    if (!ready) throw new Error("Новая картинка не появилась");

    try {
      await injectMainBlobCapture(gemini.id);
    } catch {
      /* уже стоял */
    }
    await logBoth(admin.id, gemini.id, "Скачиваю full-size…");
    const waiter = armDownloadWaiter(90000);
    let payload = null;
    try {
      payload = await send(gemini.id, { type: "CLICK_DOWNLOAD_FULL_CAPTURE" });
      waiter.disarm();
    } catch (captureErr) {
      await logBoth(
        admin.id,
        gemini.id,
        `Перехват blob не удался: ${captureErr?.message || captureErr} → downloads API`,
        true,
      );
      const created = await waiter.promise;
      downloadId = created.id;
      await waitDownloadComplete(downloadId, 90000);
      const [item] = await chrome.downloads.search({ id: downloadId });
      payload = await fetchDownloadViaPage(gemini.id, item || created);
      await eraseDownload(downloadId);
      downloadId = null;
    }
    if (stopRequested) throw new Error("Остановлено");
    if (!payload?.imageBase64) {
      throw new Error("Нет данных изображения после скачивания");
    }

    admin = await ensureAdminTab(admin.id);
    await send(admin.id, {
      type: "UPLOAD_QUARTER",
      imageBase64: payload.imageBase64,
      mime: payload.mime || "image/jpeg",
      corner,
    });
    await logBoth(admin.id, gemini.id, "Четверть загружена");
    await closeLogs(admin.id, gemini.id, 600);
    return { ok: true, corner, size: payload.size };
  } catch (err) {
    const msg = err?.message || String(err);
    const stopped = stopRequested || msg === "Остановлено";
    await logBoth(admin?.id, gemini?.id, stopped ? "Остановлено" : msg, !stopped);
    await closeLogs(admin?.id, gemini?.id, stopped ? 600 : 5000);
    if (stopped) return { ok: false, error: "Остановлено" };
    throw err;
  } finally {
    if (downloadId != null) {
      await eraseDownload(downloadId).catch(() => {});
    }
    running = false;
    stopRequested = false;
  }
}

/** Четверти идут по очереди: кнопки в админке можно жать в любом порядке. */
let quarterChain = Promise.resolve();
let quarterGeneration = 0;

function enqueueLocationQuarter(args) {
  const generation = quarterGeneration;
  const run = quarterChain.then(() => {
    if (generation !== quarterGeneration) {
      return { ok: false, error: "Остановлено" };
    }
    return runGeminiLocationQuarter(args);
  });
  quarterChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "RETRY_STEP") {
      return await requestStepRetry();
    }
    if (msg?.type === "STOP") {
      stopRequested = true;
      quarterGeneration += 1;
      return { ok: true };
    }
    if (msg?.type === "START_AUTO_LOOP_ICONS") {
      return runGeminiIconAutoLoop(sender?.tab?.id, msg.chatUrl, {
        maxIcons: msg.maxIcons,
        advance: msg.advance,
      });
    }
    if (msg?.type === "START_RETOUCH_ICONS") {
      return runGeminiIconRetouchLoop(sender?.tab?.id, msg.chatUrl, {
        maxIcons: msg.maxIcons,
        advance: msg.advance,
      });
    }
    if (msg?.type === "START_ALTER_ICON") {
      return runGeminiIconAlter(sender?.tab?.id, msg.chatUrl);
    }
    if (msg?.type === "START_LOCATION_QUARTER") {
      return enqueueLocationQuarter({
        imageBase64: msg.imageBase64,
        mime: msg.mime,
        corner: msg.corner,
        prompt: msg.prompt,
        adminTabId: sender?.tab?.id,
      });
    }
    if (msg?.type === "START_GENERATE") {
      if (msg.provider && msg.provider !== "gemini") {
        throw new Error(`Провайдер «${msg.provider}» пока не поддержан`);
      }
      return runGeminiGenerate({
        prompt: msg.prompt,
        locationId: msg.locationId,
        adminTabId: sender?.tab?.id,
      });
    }
    return { ok: false, error: "unknown message" };
  })()
    .then(sendResponse)
    .catch((err) =>
      sendResponse({ ok: false, error: err?.message || String(err) }),
    );
  return true;
});
