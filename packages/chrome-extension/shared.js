(() => {
  const root = (globalThis.LFightExt = globalThis.LFightExt || {});

  root.GEMINI_CHAT_URL =
    "https://gemini.google.com/app/44ed1351aab8bed6?dest=create";
  /** Пустой чат. Доработка иконок каждый раз начинает с него. */
  root.GEMINI_NEW_CHAT_URL = "https://gemini.google.com/app";

  root.STEP_MS = 350;
  /** Пауза между шагами UI (Angular/Quill успевает перерисоваться). */
  root.GAP_MS = 700;
  /** Короткая пауза между фазами: Изменить → текст → Обновить. */
  root.GAP_PHASE_MS = 500;
  root.GAP_AFTER_CLICK_MS = 900;
  root.GAP_AFTER_INSERT_MS = 1200;
  root.WAIT_EDIT_MS = 25000;
  root.WAIT_INSERT_MS = 25000;
  /** Локации: нет картинки — background перезагружает чат Gemini. */
  root.WAIT_GEN_MS = 240000;
  /** Иконки: нет картинки за 2 минуты — полный повтор шага с промпта. */
  root.ICON_WAIT_IMAGE_MS = 120000;
  /** «Изменить»: ждём, пока пользователь допишет промпт и Gemini сгенерирует картинку. */
  root.WAIT_ALTER_MS = 600000;
  /** Текст, который «изменить» пишет в composer после вставки иконки. */
  root.ALTER_CONTINUE_TEXT = "Для этого изображения ";
  root.WAIT_DOWNLOAD_MS = 60000;

  root.LOG_PANEL_ID = "l-fight-ext-log-panel";
  root.LOG_LIST_ID = "l-fight-ext-log-list";
  root.LOG_RETRY_ID = "l-fight-ext-retry-step";
  root.STEP_RETRY = "STEP_RETRY";
  root.stepRetryRequested = false;
  root.abortEpoch = 0;
  root.armedEpoch = 0;

  root.isStepRetry = (err) =>
    /^STEP_RETRY\b/.test(err?.message || String(err || ""));

  root.rethrowIfStepRetry = (err) => {
    if (root.isStepRetry(err)) throw err;
  };

  /** Новый шаг: сбросить ручной повтор, если он относился к предыдущему. */
  root.armStep = (epoch) => {
    const n = Number(epoch) || 0;
    root.armedEpoch = n;
    if (root.abortEpoch <= n) root.stepRetryRequested = false;
  };

  /** Кнопка «Перезагрузить шаг»: оборвать текущие sleep/wait. */
  root.abortStep = (epoch) => {
    const n = Number(epoch) || 0;
    if (n > root.abortEpoch) root.abortEpoch = n;
    if (root.abortEpoch > root.armedEpoch) root.stepRetryRequested = true;
  };

  root.sleep = (ms) =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (root.stepRetryRequested) {
          reject(new Error(root.STEP_RETRY));
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

  /** Обёртка: операция не должна висеть дольше timeoutMs. */
  root.withTimeout = (promise, timeoutMs, label = "операция") => {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Таймаут: ${label} (${timeoutMs}ms)`)),
        timeoutMs,
      );
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  };

  root.visible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  root.clickEl = (el) => {
    if (!el) return false;
    el.scrollIntoView({ block: "center", inline: "nearest" });
    el.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    el.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    el.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, cancelable: true }),
    );
    el.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
    );
    el.click();
    return true;
  };

  root.btnText = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();

  root.waitFor = async (fn, timeoutMs, label = "элемент") => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = fn();
      if (value) return value;
      await root.sleep(root.STEP_MS);
    }
    throw new Error(`Таймаут: ${label} (${timeoutMs}ms)`);
  };

  root.uint8ToBase64 = (bytes) => {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      binary += String.fromCharCode(...u8.subarray(i, i + chunk));
    }
    return btoa(binary);
  };

  root.blobToBase64 = async (blob) => {
    const buf = await blob.arrayBuffer();
    return root.uint8ToBase64(new Uint8Array(buf));
  };

  root.base64ToUint8 = (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  root.base64ToBlob = (base64, mime = "image/png") => {
    const bytes = root.base64ToUint8(base64);
    return new Blob([bytes], { type: mime });
  };

  /** Magic bytes → mime (null если не картинка). */
  root.sniffImageMime = (bytes) => {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
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
        const rest = String.fromCharCode(...u8.subarray(8, Math.min(24, u8.length)));
        if (/avif|avis|mif1/i.test(rest)) return "image/avif";
      }
    }
    return null;
  };

  /**
   * Декод браузером → JPEG. Чинит AVIF/WebP и битый ArrayBuffer-transfer
   * (server sharp тогда всегда получает валидный JPEG).
   */
  root.transcodeToJpeg = async (blobOrBase64, mimeHint = "image/png") => {
    const blob =
      typeof blobOrBase64 === "string"
        ? root.base64ToBlob(blobOrBase64, mimeHint)
        : blobOrBase64;
    if (!blob?.size) throw new Error("Пустой blob для transcode");

    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      if (canvas.width < 64 || canvas.height < 64) {
        throw new Error(`Слишком маленький кадр ${canvas.width}×${canvas.height}`);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context недоступен");
      ctx.drawImage(bitmap, 0, 0);
      const jpegBlob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))),
          "image/jpeg",
          0.92,
        );
      });
      const imageBase64 = await root.blobToBase64(jpegBlob);
      return {
        imageBase64,
        mime: "image/jpeg",
        size: jpegBlob.size,
        width: canvas.width,
        height: canvas.height,
        blob: jpegBlob,
      };
    } finally {
      bitmap.close();
    }
  };

  /** PNG для clipboard.write (Chrome принимает image/png). */
  root.blobToPng = async (blob) => {
    if (!blob?.size) throw new Error("Пустой blob для PNG");
    if (blob.type === "image/png") return blob;
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context недоступен");
      ctx.drawImage(bitmap, 0, 0);
      return await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("png toBlob failed"))),
          "image/png",
        );
      });
    } finally {
      bitmap.close();
    }
  };

  root.writeClipboardPng = async (blob) => {
    const png = await root.blobToPng(blob);
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": png }),
    ]);
    return png;
  };

  /** Окно логов автоматизации (admin + Gemini). */
  root.openLogPanel = (title = "L-Fight Autofill") => {
    let panel = document.getElementById(root.LOG_PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = root.LOG_PANEL_ID;
      panel.style.cssText =
        "position:fixed;z-index:2147483646;right:12px;bottom:12px;width:min(420px,92vw);" +
        "max-height:min(420px,50vh);display:flex;flex-direction:column;" +
        "background:rgba(12,12,14,.96);color:#e8dfc4;border:1px solid #5a4a28;" +
        "border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.55);" +
        "font:12px/1.4 ui-monospace,Consolas,monospace;overflow:hidden;";
      const head = document.createElement("div");
      head.dataset.lFightLogHead = "1";
      head.style.cssText =
        "display:flex;align-items:center;gap:8px;padding:8px 10px;" +
        "background:#1c1810;border-bottom:1px solid #5a4a28;" +
        "font-weight:600;color:#c9a227;flex-shrink:0;";
      const titleEl = document.createElement("div");
      titleEl.style.cssText =
        "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      titleEl.textContent = title;
      const retryBtn = document.createElement("button");
      retryBtn.id = root.LOG_RETRY_ID;
      retryBtn.type = "button";
      retryBtn.textContent = "Перезагрузить шаг";
      retryBtn.title =
        "Прервать текущее ожидание и повторить шаг: генерация, копирование, сохранение";
      retryBtn.style.cssText =
        "cursor:pointer;flex-shrink:0;border:0;border-radius:6px;padding:4px 8px;" +
        "background:#8a5a12;color:#fff;font:11px/1.2 system-ui,sans-serif;font-weight:600;";
      retryBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          chrome.runtime.sendMessage({ type: "RETRY_STEP" }, (res) => {
            const runtimeError = chrome.runtime.lastError;
            if (runtimeError) {
              root.appendLog(
                runtimeError.message || "Не удалось перезагрузить шаг",
                true,
              );
              return;
            }
            if (!res?.ok || res.idle) {
              root.appendLog("Нет активного шага", true);
              return;
            }
            root.appendLog("Перезагрузка шага…", true);
          });
        } catch (err) {
          root.appendLog(err?.message || "Не удалось перезагрузить шаг", true);
        }
      });
      head.appendChild(titleEl);
      head.appendChild(retryBtn);
      const list = document.createElement("div");
      list.id = root.LOG_LIST_ID;
      list.style.cssText =
        "padding:8px 10px;overflow:auto;flex:1;white-space:pre-wrap;word-break:break-word;";
      panel.appendChild(head);
      panel.appendChild(list);
      document.documentElement.appendChild(panel);
    }
    panel.style.display = "flex";
    const list = document.getElementById(root.LOG_LIST_ID);
    if (list) list.textContent = "";
    return panel;
  };

  root.appendLog = (line, isError = false) => {
    let panel = document.getElementById(root.LOG_PANEL_ID);
    if (!panel) panel = root.openLogPanel();
    panel.style.display = "flex";
    const list = document.getElementById(root.LOG_LIST_ID);
    if (!list) return;
    const row = document.createElement("div");
    const ts = new Date().toLocaleTimeString();
    row.style.color = isError ? "#ffb4a8" : "#e8dfc4";
    row.style.marginBottom = "4px";
    row.textContent = `[${ts}] ${line}`;
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
  };

  root.closeLogPanel = (delayMs = 0) => {
    const panel = document.getElementById(root.LOG_PANEL_ID);
    if (!panel) return;
    const hide = () => {
      panel.style.display = "none";
      const list = document.getElementById(root.LOG_LIST_ID);
      if (list) list.textContent = "";
    };
    if (delayMs > 0) setTimeout(hide, delayMs);
    else hide();
  };

  /** Короткий отпечаток image-blob (size + head/tail). */
  root.fingerprintBlob = async (blob) => {
    if (!blob || !blob.size) return null;
    const size = blob.size;
    const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
    const tail = new Uint8Array(
      await blob.slice(Math.max(0, size - 64)).arrayBuffer(),
    );
    let h = size >>> 0;
    for (const b of head) h = (Math.imul(h, 16777619) ^ b) >>> 0;
    for (const b of tail) h = (Math.imul(h, 16777619) ^ b) >>> 0;
    return `${size}:${h.toString(16)}`;
  };

  /**
   * Отпечаток пикселей (грубая сетка). Совпадает у одной картинки
   * после JPEG→PNG, и различает исходную иконку и новый кадр.
   */
  root.fingerprintPixels = async (blob) => {
    if (!blob?.size) return null;
    const bitmap = await createImageBitmap(blob);
    try {
      const side = 16;
      const canvas = document.createElement("canvas");
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("2d context недоступен");
      ctx.drawImage(bitmap, 0, 0, side, side);
      const data = ctx.getImageData(0, 0, side, side).data;
      let hash = 2166136261;
      for (let i = 0; i < data.length; i += 4) {
        const q =
          (data[i] >> 4) |
          ((data[i + 1] >> 4) << 4) |
          ((data[i + 2] >> 4) << 8);
        hash = Math.imul(hash ^ q, 16777619) >>> 0;
      }
      return `${bitmap.width}x${bitmap.height}:${hash.toString(16)}`;
    } finally {
      bitmap.close();
    }
  };

  root.readClipboardImageBlob = async (minBytes = 1024) => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        if (blob && blob.size >= minBytes) {
          return { ok: true, type: imageType, size: blob.size, blob };
        }
        if (blob) {
          return {
            ok: false,
            reason: `image слишком маленькая (${blob.size} байт)`,
            size: blob.size,
          };
        }
      }
      return { ok: false, reason: "в буфере нет image/*" };
    } catch (err) {
      return { ok: false, reason: err?.message || String(err) };
    }
  };

  root.readClipboardFingerprint = async (minBytes = 1024) => {
    const info = await root.readClipboardImageBlob(minBytes);
    if (!info.ok || !info.blob) {
      return { ok: false, reason: info.reason || "нет image" };
    }
    const fingerprint = await root.fingerprintBlob(info.blob);
    return {
      ok: true,
      type: info.type,
      size: info.size,
      fingerprint,
    };
  };

  root.clearClipboardImage = async () => {
    try {
      await navigator.clipboard.writeText("l-fight-clipboard-cleared");
    } catch {
      try {
        await navigator.clipboard.writeText("");
      } catch {
        return { ok: false, reason: "clipboard.writeText failed" };
      }
    }
    await root.sleep(120);
    const still = await root.readClipboardImageBlob(1024);
    if (still.ok) {
      return { ok: false, reason: "после очистки в буфере всё ещё image" };
    }
    return { ok: true, cleared: true };
  };

  /** localStorage: последний URL чата Gemini + история стартов. */
  root.GEMINI_CHAT_URL_LS_KEY = "l-fight-ext-gemini-chat-url";
  root.GEMINI_CHAT_URL_HISTORY_LS_KEY = "l-fight-ext-gemini-chat-url-history";
  root.GEMINI_CHAT_URL_HISTORY_MAX = 40;

  root.normalizeGeminiChatUrl = (url) => {
    const u = String(url || "").trim();
    if (!u) throw new Error("Укажите URL чата Gemini");
    if (!/^https:\/\/gemini\.google\.com\//i.test(u)) {
      throw new Error("URL должен начинаться с https://gemini.google.com/");
    }
    return u;
  };

  root.getGeminiChatUrl = () => {
    try {
      const raw = localStorage.getItem(root.GEMINI_CHAT_URL_LS_KEY);
      const u = String(raw || "").trim();
      if (u) return u;
    } catch {
      /* ignore */
    }
    return root.GEMINI_CHAT_URL;
  };

  root.setGeminiChatUrl = (url) => {
    const u = root.normalizeGeminiChatUrl(url);
    localStorage.setItem(root.GEMINI_CHAT_URL_LS_KEY, u);
    return u;
  };

  root.getGeminiChatUrlHistory = () => {
    try {
      const raw = localStorage.getItem(root.GEMINI_CHAT_URL_HISTORY_LS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list
        .filter((e) => e && typeof e.url === "string" && e.url.trim())
        .map((e) => ({
          date: String(e.date || ""),
          url: String(e.url).trim(),
        }));
    } catch {
      return [];
    }
  };

  /**
   * Сохраняет текущий URL и добавляет в историю, если такой ссылки ещё не было.
   * @returns {{ url: string, historyAdded: boolean }}
   */
  root.saveGeminiChatUrlWithHistory = (url) => {
    const u = root.setGeminiChatUrl(url);
    const history = root.getGeminiChatUrlHistory();
    const exists = history.some((e) => e.url === u);
    if (!exists) {
      history.unshift({ date: new Date().toISOString(), url: u });
      const trimmed = history.slice(0, root.GEMINI_CHAT_URL_HISTORY_MAX);
      localStorage.setItem(
        root.GEMINI_CHAT_URL_HISTORY_LS_KEY,
        JSON.stringify(trimmed),
      );
      return { url: u, historyAdded: true };
    }
    return { url: u, historyAdded: false };
  };

  root.formatGeminiChatHistoryDate = (iso) => {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso || "");
      return d.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(iso || "");
    }
  };
})();
