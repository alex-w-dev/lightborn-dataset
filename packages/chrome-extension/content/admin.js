(() => {
  const S = globalThis.LFightExt;

  const PANEL_ID = "l-fight-icons-panel";
  const BTN_AUTO = "l-fight-icons-auto";
  const BTN_ONCE = "l-fight-icons-once";
  const BTN_ALTER = "l-fight-icons-alter";
  const BTN_STOP = "l-fight-icons-stop";
  const CHAT_MODAL_ID = "l-fight-gemini-chat-modal";

  function isGameIconsPage() {
    return /\/dataset\/game-icons\/?/.test(location.pathname);
  }

  function clearAdminErrors() {
    window.dispatchEvent(new CustomEvent("l-fight-admin-clear-error"));
  }

  function dispatchUploadImage(blob) {
    clearAdminErrors();
    window.dispatchEvent(
      new CustomEvent("l-fight-admin-upload-image", {
        detail: { blob },
        bubbles: true,
      }),
    );
  }

  function dispatchSaveRaw(blob, advance = true) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        window.removeEventListener("l-fight-admin-save-raw-result", onResult);
        reject(new Error("PASTE_FAILED: таймаут сохранения буфера"));
      }, 20000);
      const onResult = (event) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener("l-fight-admin-save-raw-result", onResult);
        const detail = event.detail || {};
        if (!detail.ok) {
          reject(
            new Error(
              `PASTE_FAILED: ${detail.error || "не сохранилось в буфер"}`,
            ),
          );
          return;
        }
        resolve(true);
      };
      window.addEventListener("l-fight-admin-save-raw-result", onResult);
      clearAdminErrors();
      window.dispatchEvent(
        new CustomEvent("l-fight-admin-save-raw-image", {
          detail: { blob, advance },
          bubbles: true,
        }),
      );
    });
  }

  function findPromptTextarea() {
    const labels = [...document.querySelectorAll("label")];
    const byLabel = labels.find(
      (l) => (l.textContent || "").trim() === "Промпт",
    );
    if (byLabel) {
      const id = byLabel.getAttribute("for");
      if (id) {
        const byId = document.getElementById(id);
        if (byId) return byId;
      }
      const nested = byLabel.querySelector("textarea");
      if (nested) return nested;
    }
    const fields = [...document.querySelectorAll("textarea")];
    return (
      fields.find((ta) => {
        const wrap = ta.closest(
          ".MuiFormControl-root, .MuiTextField-root, label, div",
        );
        return wrap && (wrap.textContent || "").includes("Промпт");
      }) ||
      fields[0] ||
      null
    );
  }

  function getPrompt() {
    const ta = findPromptTextarea();
    return (ta?.value || "").trim();
  }

  function getSelectedIcon() {
    const selected = document.querySelector(
      ".MuiListItemButton-root.Mui-selected .MuiListItemText-primary, .MuiListItemButton-root.Mui-selected",
    );
    if (!selected) return "";
    const textEl = selected.classList?.contains("MuiListItemText-primary")
      ? selected
      : selected.querySelector(".MuiListItemText-primary");
    return (textEl?.textContent || selected.textContent || "").trim();
  }

  function getEditorIcon() {
    const h = [...document.querySelectorAll("h6, .MuiTypography-h6")].find(
      (el) => (el.textContent || "").includes("Редактор иконки:"),
    );
    if (!h) return getSelectedIcon();
    return (h.textContent || "")
      .replace(/^.*Редактор иконки:\s*/i, "")
      .trim();
  }

  async function waitForPrompt(prevPrompt = null, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const prompt = getPrompt();
      const icon = getEditorIcon();
      if (
        prompt &&
        prompt !== "-" &&
        prompt !== prevPrompt &&
        icon &&
        icon !== "-"
      ) {
        return { prompt, icon };
      }
      await S.sleep(250);
    }
    const prompt = getPrompt();
    const icon = getEditorIcon();
    if (prompt && icon && icon !== "-") return { prompt, icon };
    throw new Error("Нет промпта / выбранной иконки");
  }

  function selectNextIconInList() {
    const items = [...document.querySelectorAll(".MuiListItemButton-root")];
    const idx = items.findIndex((el) => el.classList.contains("Mui-selected"));
    if (idx < 0) return false;
    const next = items[idx + 1];
    if (!next) return false;
    S.clickEl(next);
    return true;
  }

  async function skipToNextIcon() {
    const prevIcon = getEditorIcon();
    const prevPrompt = getPrompt();
    selectNextIconInList();
    await S.sleep(400);
    try {
      const next = await waitForPrompt(prevPrompt, 20000);
      return {
        ok: true,
        done: false,
        prompt: next.prompt,
        icon: next.icon,
        advanced: next.icon !== prevIcon,
      };
    } catch {
      return {
        ok: true,
        done: true,
        prompt: "",
        icon: getEditorIcon(),
        advanced: getEditorIcon() !== prevIcon,
      };
    }
  }

  async function saveRawAndAdvance({
    imageBase64,
    mime,
    expectedFingerprint,
    advance = true,
  }) {
    const prevIcon = getEditorIcon();
    const prevPrompt = getPrompt();
    clearAdminErrors();

    let blob = null;
    let lastReason = "пусто";

    if (imageBase64) {
      try {
        blob = S.base64ToBlob(imageBase64, mime || "image/jpeg");
        const fp = await S.fingerprintBlob(blob);
        if (expectedFingerprint && fp !== expectedFingerprint) {
          lastReason = `stale base64 fp=${fp}, ждали ${expectedFingerprint}`;
          blob = null;
        }
      } catch (e) {
        lastReason = e?.message || "base64 decode failed";
        blob = null;
      }
    }

    if (!blob) {
      for (let i = 0; i < 6; i++) {
        const info = await S.readClipboardImageBlob(1500);
        if (!info.ok || !info.blob) {
          lastReason = info.reason || "нет image";
          await S.sleep(350);
          continue;
        }
        const fp = await S.fingerprintBlob(info.blob);
        if (expectedFingerprint && fp !== expectedFingerprint) {
          lastReason = `stale fp=${fp}, ждали ${expectedFingerprint}`;
          await S.sleep(350);
          continue;
        }
        blob = info.blob;
        break;
      }
    }
    if (!blob) {
      throw new Error(`PASTE_FAILED: ${lastReason}`);
    }

    S.appendLog("Буфер All-raw → apply 512…");
    await dispatchSaveRaw(blob, true);

    await S.clearClipboardImage();
    await S.sleep(200);

    if (!advance) {
      return {
        ok: true,
        done: true,
        prompt: "",
        icon: getEditorIcon(),
        advanced: false,
      };
    }

    // Следующую выбирает админка: фильтр убирает сохранённую иконку из списка.
    try {
      const next = await waitForPrompt(prevPrompt, 20000);
      return {
        ok: true,
        done: false,
        prompt: next.prompt,
        icon: next.icon,
        advanced: next.icon !== prevIcon,
      };
    } catch {
      return {
        ok: true,
        done: true,
        prompt: "",
        icon: getEditorIcon(),
        advanced: getEditorIcon() !== prevIcon,
      };
    }
  }

  function iconIdFromEditor() {
    const raw = String(getEditorIcon() || "").trim();
    const id = raw.split(/\s+/)[0]?.replace(/[()]/g, "") || "";
    if (!id || id === "-" || id === "Редактор") {
      throw new Error("Нет выбранной иконки");
    }
    return id;
  }

  async function readLocal512() {
    const icon = iconIdFromEditor();
    const url = `/api/icons/generated/${encodeURIComponent(icon)}?v=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) {
      throw new Error(`Нет локальной 512 для ${icon} (${res.status})`);
    }
    const blob = await res.blob();
    if (!blob.size) throw new Error(`Пустая локальная 512 (${icon})`);
    try {
      await S.writeClipboardPng(blob);
    } catch {
      /* Gemini-вкладка запишет буфер ещё раз перед вставкой */
    }
    const buf = new Uint8Array(await blob.arrayBuffer());
    return {
      ok: true,
      icon,
      imageBase64: S.uint8ToBase64(buf),
      mime: blob.type || "image/png",
      size: blob.size,
    };
  }

  function isIconRetouchPage() {
    return /\/dataset\/icon-retouch\/?/.test(location.pathname);
  }

  async function waitIconAdvanced(prevIcon, timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const icon = getEditorIcon();
      if (icon && icon !== "-" && icon !== prevIcon) {
        return {
          ok: true,
          done: false,
          prompt: getPrompt(),
          icon,
          advanced: true,
        };
      }
      await S.sleep(250);
    }
    return {
      ok: true,
      done: true,
      prompt: getPrompt(),
      icon: getEditorIcon(),
      advanced: false,
    };
  }

  function readS3FromPage() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        window.removeEventListener("l-fight-admin-read-s3-result", onResult);
        reject(new Error("Таймаут чтения S3"));
      }, 20000);
      const onResult = (event) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener("l-fight-admin-read-s3-result", onResult);
        resolve(event.detail || { ok: false, missing: true });
      };
      window.addEventListener("l-fight-admin-read-s3-result", onResult);
      window.dispatchEvent(new CustomEvent("l-fight-admin-read-s3"));
    });
  }

  async function decodeIncomingImage({ imageBase64, mime, expectedFingerprint }) {
    let blob = null;
    let lastReason = "пусто";
    if (imageBase64) {
      try {
        blob = S.base64ToBlob(imageBase64, mime || "image/jpeg");
        const fp = await S.fingerprintBlob(blob);
        if (expectedFingerprint && fp !== expectedFingerprint) {
          lastReason = `stale base64 fp=${fp}, ждали ${expectedFingerprint}`;
          blob = null;
        }
      } catch (e) {
        lastReason = e?.message || "base64 decode failed";
        blob = null;
      }
    }
    if (!blob) {
      for (let i = 0; i < 6; i++) {
        const info = await S.readClipboardImageBlob(1500);
        if (!info.ok || !info.blob) {
          lastReason = info.reason || "нет image";
          await S.sleep(350);
          continue;
        }
        const fp = await S.fingerprintBlob(info.blob);
        if (expectedFingerprint && fp !== expectedFingerprint) {
          lastReason = `stale fp=${fp}, ждали ${expectedFingerprint}`;
          await S.sleep(350);
          continue;
        }
        blob = info.blob;
        break;
      }
    }
    if (!blob) throw new Error(`PASTE_FAILED: ${lastReason}`);
    return blob;
  }

  async function previewPixels(icon, kind) {
    const path =
      kind === "raw"
        ? `/api/icons/raw-retouch/${encodeURIComponent(icon)}`
        : `/api/icons/generated-retouch/${encodeURIComponent(icon)}`;
    const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`PASTE_FAILED: не прочитать ${kind} (${response.status})`);
    }
    const blob = await response.blob();
    if (!blob?.size) return null;
    return S.fingerprintPixels(blob);
  }

  function reportRetouchError(message) {
    window.dispatchEvent(
      new CustomEvent("l-fight-admin-retouch-error", {
        detail: { error: message },
      }),
    );
  }

  async function saveRetouchAndAdvance({
    imageBase64,
    mime,
    expectedFingerprint,
    expectedPixels,
    advance = true,
  }) {
    const prevIcon = getEditorIcon();
    clearAdminErrors();
    const beforeRaw = await previewPixels(prevIcon, "raw");
    const before512 = await previewPixels(prevIcon, "generated");
    const blob = await decodeIncomingImage({
      imageBase64,
      mime,
      expectedFingerprint,
    });
    S.appendLog("Буфер All-raw-retouch → apply 512…");
    await dispatchSaveRaw(blob, false);
    await S.sleep(200);
    const afterRaw = await previewPixels(prevIcon, "raw");
    const after512 = await previewPixels(prevIcon, "generated");
    if (!afterRaw) {
      const message = "Сырой буфер пуст после сохранения";
      reportRetouchError(message);
      throw new Error(`PASTE_FAILED: ${message}`);
    }
    if (expectedPixels && afterRaw !== expectedPixels) {
      const message = "В буфер попала не новая картинка";
      reportRetouchError(message);
      throw new Error(`PASTE_FAILED: ${message}`);
    }
    if (beforeRaw && afterRaw === beforeRaw) {
      const message = "Сырой буфер не изменился";
      reportRetouchError(message);
      throw new Error(`PASTE_FAILED: ${message}`);
    }
    if (!after512) {
      const message = "512 не применилась";
      reportRetouchError(message);
      throw new Error(`PASTE_FAILED: ${message}`);
    }
    if (before512 && after512 === before512) {
      const message = "Локальная 512 не изменилась";
      reportRetouchError(message);
      throw new Error(`PASTE_FAILED: ${message}`);
    }
    S.appendLog(`Применено: буфер и 512 изменились px=${afterRaw}`);
    if (!advance) {
      return {
        ok: true,
        done: true,
        prompt: getPrompt(),
        icon: getEditorIcon(),
        advanced: false,
        changed: true,
      };
    }
    // Следующую выбирает админка: фильтр убирает сохранённую иконку из списка.
    const advanced = await waitIconAdvanced(prevIcon, 8000);
    return { ...advanced, changed: true };
  }

  async function skipRetouchToNext() {
    const prevIcon = getEditorIcon();
    window.dispatchEvent(new CustomEvent("l-fight-admin-advance-retouch"));
    await S.sleep(200);
    return waitIconAdvanced(prevIcon, 4000);
  }

  function setBusy(busy) {
    const auto = document.getElementById(BTN_AUTO);
    const once = document.getElementById(BTN_ONCE);
    const alter = document.getElementById(BTN_ALTER);
    const stop = document.getElementById(BTN_STOP);
    const retouchAuto = document.getElementById("l-fight-retouch-auto");
    const retouchOnce = document.getElementById("l-fight-retouch-once");
    const retouchStop = document.getElementById("l-fight-retouch-stop");
    if (auto) auto.disabled = busy;
    if (once) once.disabled = busy;
    if (alter) alter.disabled = busy;
    if (stop) stop.style.display = busy ? "inline-flex" : "none";
    if (retouchAuto) retouchAuto.disabled = busy;
    if (retouchOnce) retouchOnce.disabled = busy;
    if (retouchStop) retouchStop.style.display = busy ? "inline-flex" : "none";
  }

  function closeGeminiChatUrlModal() {
    document.getElementById(CHAT_MODAL_ID)?.remove();
  }

  /**
   * Модалка URL чата Gemini: prefill из localStorage + история по дате.
   * @returns {Promise<string|null>} выбранный URL или null при отмене
   */
  function promptGeminiChatUrl() {
    closeGeminiChatUrlModal();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        closeGeminiChatUrlModal();
        resolve(value);
      };

      const overlay = document.createElement("div");
      overlay.id = CHAT_MODAL_ID;
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;display:flex;" +
        "align-items:center;justify-content:center;" +
        "background:rgba(0,0,0,.55);font:13px/1.35 system-ui,sans-serif;";

      const card = document.createElement("div");
      card.style.cssText =
        "width:min(560px,92vw);max-height:min(80vh,640px);overflow:auto;" +
        "background:#141418;color:#eee;border:1px solid #3a5a3a;" +
        "border-radius:12px;padding:16px 16px 14px;" +
        "box-shadow:0 16px 48px rgba(0,0,0,.55);";

      const title = document.createElement("div");
      title.textContent = "URL чата Gemini";
      title.style.cssText = "font-weight:700;font-size:15px;margin-bottom:10px;";

      const hint = document.createElement("div");
      hint.textContent =
        "Вставьте ссылку нужного чата. Последнее значение и история — в localStorage.";
      hint.style.cssText =
        "color:#9aa;font-size:12px;margin-bottom:10px;";

      const input = document.createElement("input");
      input.type = "url";
      input.value = S.getGeminiChatUrl();
      input.placeholder = S.GEMINI_CHAT_URL;
      input.spellcheck = false;
      input.style.cssText =
        "width:100%;box-sizing:border-box;padding:10px 12px;" +
        "border-radius:8px;border:1px solid #456;background:#0c0c0e;" +
        "color:#fff;font:13px/1.3 ui-monospace,Consolas,monospace;";

      const err = document.createElement("div");
      err.style.cssText =
        "display:none;color:#f88;font-size:12px;margin-top:8px;";

      const historyTitle = document.createElement("div");
      historyTitle.textContent = "История стартов";
      historyTitle.style.cssText =
        "margin:14px 0 8px;font-weight:600;font-size:12px;color:#bbb;";

      const historyList = document.createElement("div");
      historyList.style.cssText =
        "display:flex;flex-direction:column;gap:6px;max-height:220px;" +
        "overflow:auto;margin-bottom:14px;";

      const history = S.getGeminiChatUrlHistory();
      if (!history.length) {
        const empty = document.createElement("div");
        empty.textContent = "Пока пусто — появится после первого старта.";
        empty.style.cssText = "color:#777;font-size:12px;";
        historyList.appendChild(empty);
      } else {
        for (const entry of history) {
          const row = document.createElement("button");
          row.type = "button";
          row.title = entry.url;
          row.style.cssText =
            "text-align:left;cursor:pointer;border:1px solid #333;" +
            "border-radius:8px;padding:8px 10px;background:#1a1a20;" +
            "color:#ddd;font:12px/1.35 system-ui,sans-serif;";
          const dateEl = document.createElement("div");
          dateEl.textContent = S.formatGeminiChatHistoryDate(entry.date);
          dateEl.style.cssText = "color:#8c8;font-weight:600;margin-bottom:2px;";
          const urlEl = document.createElement("div");
          urlEl.textContent = entry.url;
          urlEl.style.cssText =
            "word-break:break-all;color:#aaa;font:11px/1.3 ui-monospace,Consolas,monospace;";
          row.appendChild(dateEl);
          row.appendChild(urlEl);
          row.addEventListener("click", () => {
            input.value = entry.url;
            err.style.display = "none";
            input.focus();
            input.select();
          });
          historyList.appendChild(row);
        }
      }

      const actions = document.createElement("div");
      actions.style.cssText =
        "display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = "Отмена";
      cancelBtn.style.cssText =
        "cursor:pointer;border:0;border-radius:8px;padding:8px 14px;" +
        "background:#333;color:#fff;font-weight:600;";

      const startBtn = document.createElement("button");
      startBtn.type = "button";
      startBtn.textContent = "Старт";
      startBtn.style.cssText =
        "cursor:pointer;border:0;border-radius:8px;padding:8px 14px;" +
        "background:#2e7d32;color:#fff;font-weight:600;";

      const onCancel = () => finish(null);
      const onStart = () => {
        try {
          const saved = S.saveGeminiChatUrlWithHistory(input.value);
          finish(saved.url);
        } catch (e) {
          err.textContent = e?.message || String(e);
          err.style.display = "block";
        }
      };

      cancelBtn.addEventListener("click", onCancel);
      startBtn.addEventListener("click", onStart);
      overlay.addEventListener("click", (ev) => {
        if (ev.target === overlay) onCancel();
      });
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          onStart();
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          onCancel();
        }
      });

      actions.appendChild(cancelBtn);
      actions.appendChild(startBtn);
      card.appendChild(title);
      card.appendChild(hint);
      card.appendChild(input);
      card.appendChild(err);
      card.appendChild(historyTitle);
      card.appendChild(historyList);
      card.appendChild(actions);
      overlay.appendChild(card);
      document.documentElement.appendChild(overlay);
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    });
  }

  function startIconsAlter(chatUrl) {
    S.openLogPanel("L-Fight Autofill · Gemini icons");
    S.appendLog("Старт: изменить (512 → продолжение чата)…");
    S.appendLog(`Чат: ${chatUrl}`);
    chrome.runtime.sendMessage(
      { type: "START_ALTER_ICON", chatUrl },
      (res) => {
        if (chrome.runtime.lastError) {
          S.appendLog(chrome.runtime.lastError.message || "Ошибка SW", true);
          S.closeLogPanel(5000);
          return;
        }
        if (!res?.ok) {
          S.appendLog(res?.error || "Изменить завершилось с ошибкой", true);
          S.closeLogPanel(6000);
        }
      },
    );
  }

  function startIconsAutoLoop(chatUrl, options = {}) {
    const once = Boolean(options.once);
    S.openLogPanel("L-Fight Autofill · Gemini icons");
    S.appendLog(once ? "Старт: один цикл Gemini…" : "Старт автоцикла иконок…");
    S.appendLog(`Чат: ${chatUrl}`);
    chrome.runtime.sendMessage(
      {
        type: "START_AUTO_LOOP_ICONS",
        chatUrl,
        maxIcons: once ? 1 : 0,
        advance: !once,
      },
      (res) => {
        if (chrome.runtime.lastError) {
          S.appendLog(chrome.runtime.lastError.message || "Ошибка SW", true);
          S.closeLogPanel(5000);
          return;
        }
        if (!res?.ok) {
          S.appendLog(
            res?.error ||
              (once ? "Один цикл завершился с ошибкой" : "Автоцикл завершился с ошибкой"),
            true,
          );
          S.closeLogPanel(6000);
        }
      },
    );
  }

  function ensureIconsPanel() {
    if (!isGameIconsPage()) return;
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText =
      "position:fixed;z-index:2147483645;left:12px;bottom:12px;display:flex;" +
      "flex-wrap:wrap;gap:8px;align-items:center;padding:8px 10px;" +
      "background:rgba(12,12,14,.94);border:1px solid #3a5a3a;border-radius:10px;" +
      "box-shadow:0 8px 24px rgba(0,0,0,.45);font:12px/1.3 system-ui,sans-serif;";

    const autoBtn = document.createElement("button");
    autoBtn.id = BTN_AUTO;
    autoBtn.type = "button";
    autoBtn.textContent = "Gemini ×1 автоцикл";
    autoBtn.title =
      "Gemini: выбор URL чата → правка запроса → генерация → «Копировать изображение» → сырой буфер+512 → следующая иконка";
    autoBtn.style.cssText =
      "cursor:pointer;border:0;border-radius:8px;padding:8px 12px;" +
      "background:#2e7d32;color:#fff;font-weight:600;";

    const onceBtn = document.createElement("button");
    onceBtn.id = BTN_ONCE;
    onceBtn.type = "button";
    onceBtn.textContent = "Gemini 1 раз";
    onceBtn.title =
      "Один цикл: генерация текущей иконки → буфер+512, без перехода к следующей";
    onceBtn.style.cssText =
      "cursor:pointer;border:0;border-radius:8px;padding:8px 12px;" +
      "background:#f9a825;color:#1a1200;font-weight:600;";

    const alterBtn = document.createElement("button");
    alterBtn.id = BTN_ALTER;
    alterBtn.type = "button";
    alterBtn.textContent = "изменить";
    alterBtn.title =
      "Скопировать локальную 512 → выбранный чат Gemini → вставить в продолжение и текст «Для этого изображения ». После вашей отправки дождаться новой картинки и сохранить её в админку";
    alterBtn.style.cssText =
      "cursor:pointer;border:0;border-radius:8px;padding:8px 12px;" +
      "background:#1565c0;color:#fff;font-weight:600;";

    const stopBtn = document.createElement("button");
    stopBtn.id = BTN_STOP;
    stopBtn.type = "button";
    stopBtn.textContent = "Стоп";
    stopBtn.style.cssText =
      "display:none;cursor:pointer;border:0;border-radius:8px;padding:8px 12px;" +
      "background:#8b0000;color:#fff;font-weight:600;";

    autoBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const chatUrl = await promptGeminiChatUrl();
      if (!chatUrl) return;
      startIconsAutoLoop(chatUrl);
    });
    onceBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const chatUrl = await promptGeminiChatUrl();
      if (!chatUrl) return;
      startIconsAutoLoop(chatUrl, { once: true });
    });
    alterBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const chatUrl = await promptGeminiChatUrl();
      if (!chatUrl) return;
      startIconsAlter(chatUrl);
    });
    stopBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      S.appendLog("Стоп запрошен");
      chrome.runtime.sendMessage({ type: "STOP" });
    });

    panel.appendChild(autoBtn);
    panel.appendChild(onceBtn);
    panel.appendChild(alterBtn);
    panel.appendChild(stopBtn);
    document.documentElement.appendChild(panel);
  }

  function startRetouchLoop(chatUrl, options = {}) {
    const once = Boolean(options.once);
    S.openLogPanel("L-Fight Autofill · доработка иконок");
    S.appendLog(once ? "Старт: одна доработка…" : "Старт автоцикла доработки…");
    S.appendLog("Новый чат Gemini");
    chrome.runtime.sendMessage(
      {
        type: "START_RETOUCH_ICONS",
        chatUrl,
        maxIcons: once ? 1 : 0,
        advance: !once,
      },
      (res) => {
        if (chrome.runtime.lastError) {
          S.appendLog(chrome.runtime.lastError.message || "Ошибка SW", true);
          S.closeLogPanel(5000);
          return;
        }
        if (!res?.ok) {
          S.appendLog(res?.error || "Доработка завершилась с ошибкой", true);
          S.closeLogPanel(6000);
        }
      },
    );
  }

  function ensureRetouchPanel() {
    if (!isIconRetouchPage()) return;
    if (document.getElementById("l-fight-retouch-panel")) return;

    const panel = document.createElement("div");
    panel.id = "l-fight-retouch-panel";
    panel.style.cssText =
      "position:fixed;z-index:2147483645;left:12px;bottom:12px;display:flex;" +
      "flex-wrap:wrap;gap:8px;align-items:center;padding:8px 10px;" +
      "background:rgba(12,12,14,.94);border:1px solid #5a4a2a;border-radius:10px;" +
      "box-shadow:0 8px 24px rgba(0,0,0,.45);font:12px/1.3 system-ui,sans-serif;";

    const autoBtn = document.createElement("button");
    autoBtn.id = "l-fight-retouch-auto";
    autoBtn.type = "button";
    autoBtn.textContent = "Доработка авто";
    autoBtn.title =
      "S3 512 → Gemini (общий промпт) → All-raw-retouch и All-512-retouch → следующая иконка";
    autoBtn.style.cssText =
      "cursor:pointer;border:0;border-radius:8px;padding:8px 12px;" +
      "background:#6d4c41;color:#fff;font-weight:600;";

    const onceBtn = document.createElement("button");
    onceBtn.id = "l-fight-retouch-once";
    onceBtn.type = "button";
    onceBtn.textContent = "Доработка 1 раз";
    onceBtn.title = "Одна иконка: S3 → Gemini → буфер и 512 доработки, без перехода";
    onceBtn.style.cssText =
      "cursor:pointer;border:0;border-radius:8px;padding:8px 12px;" +
      "background:#f9a825;color:#1a1200;font-weight:600;";

    const stopBtn = document.createElement("button");
    stopBtn.id = "l-fight-retouch-stop";
    stopBtn.type = "button";
    stopBtn.textContent = "Стоп";
    stopBtn.style.cssText =
      "display:none;cursor:pointer;border:0;border-radius:8px;padding:8px 12px;" +
      "background:#8b0000;color:#fff;font-weight:600;";

    autoBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startRetouchLoop(S.GEMINI_NEW_CHAT_URL, { once: false });
    });
    onceBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startRetouchLoop(S.GEMINI_NEW_CHAT_URL, { once: true });
    });
    stopBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      S.appendLog("Стоп запрошен");
      chrome.runtime.sendMessage({ type: "STOP" });
    });

    panel.appendChild(autoBtn);
    panel.appendChild(onceBtn);
    panel.appendChild(stopBtn);
    document.documentElement.appendChild(panel);
  }

  window.addEventListener("l-fight-admin-scale-cancel", () => {
    chrome.runtime.sendMessage({ type: "STOP" });
  });

  window.addEventListener("l-fight-admin-gemini-quarter", (ev) => {
    const detail = ev?.detail || {};
    const imageBase64 = String(detail.imageBase64 || "");
    const corner = String(detail.corner || "");
    if (!imageBase64 || !corner) {
      S.openLogPanel("L-Fight Autofill");
      S.appendLog("Нет четверти для Gemini", true);
      window.dispatchEvent(
        new CustomEvent("l-fight-admin-quarter-done", {
          detail: { error: "Нет четверти для Gemini", corner },
        }),
      );
      return;
    }
    S.openLogPanel("L-Fight Autofill · Gemini");
    S.appendLog(`Четверть ${corner}`);
    chrome.runtime.sendMessage(
      {
        type: "START_LOCATION_QUARTER",
        imageBase64,
        mime: detail.mime || "image/jpeg",
        corner,
        prompt: detail.prompt,
      },
      (res) => {
        if (chrome.runtime.lastError) {
          const error =
            chrome.runtime.lastError.message || "Ошибка расширения";
          S.appendLog(error, true);
          S.closeLogPanel(4000);
          window.dispatchEvent(
            new CustomEvent("l-fight-admin-quarter-done", {
              detail: { error, corner },
            }),
          );
          return;
        }
        if (!res?.ok) {
          const error = res?.error || "Ошибка генерации";
          const stopped = error === "Остановлено";
          S.appendLog(error, !stopped);
          S.closeLogPanel(stopped ? 800 : 5000);
          window.dispatchEvent(
            new CustomEvent("l-fight-admin-quarter-done", {
              detail: { error, corner },
            }),
          );
          return;
        }
        S.appendLog(`Готово (${Math.round((res.size || 0) / 1024)} KB)`);
        S.closeLogPanel(800);
        window.dispatchEvent(
          new CustomEvent("l-fight-admin-quarter-done", {
            detail: { corner },
          }),
        );
      },
    );
  });

  window.addEventListener("l-fight-admin-gemini-generate", (ev) => {
    const detail = ev?.detail || {};
    const prompt = String(detail.prompt || "").trim();
    const locationId = String(detail.locationId || "").trim();
    if (!prompt) {
      S.openLogPanel("L-Fight Autofill");
      S.appendLog("Нет промпта для Gemini", true);
      return;
    }
    S.openLogPanel("L-Fight Autofill · Gemini");
    S.appendLog(`Старт: ${locationId || "локация"}`);
    chrome.runtime.sendMessage(
      {
        type: "START_GENERATE",
        provider: "gemini",
        prompt,
        locationId,
      },
      (res) => {
        if (chrome.runtime.lastError) {
          const error =
            chrome.runtime.lastError.message || "Ошибка расширения";
          S.appendLog(error, true);
          S.closeLogPanel(4000);
          window.dispatchEvent(
            new CustomEvent("l-fight-admin-gemini-done", {
              detail: { error },
            }),
          );
          return;
        }
        if (!res?.ok) {
          const error = res?.error || "Ошибка генерации";
          S.appendLog(error, true);
          S.closeLogPanel(5000);
          window.dispatchEvent(
            new CustomEvent("l-fight-admin-gemini-done", {
              detail: { error },
            }),
          );
          return;
        }
        S.appendLog(
          `Готово (${Math.round((res.size || 0) / 1024)} KB) → upload`,
        );
        S.closeLogPanel(800);
        window.dispatchEvent(
          new CustomEvent("l-fight-admin-gemini-done", {
            detail: {},
          }),
        );
      },
    );
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      if (msg?.type === "ARM_STEP") {
        S.armStep(msg.epoch);
        return { ok: true };
      }
      if (msg?.type === "ABORT_STEP") {
        S.abortStep(msg.epoch);
        return { ok: true };
      }
      if (msg?.type === "PING") {
        return {
          ok: true,
          page: isIconRetouchPage()
            ? "icon-retouch"
            : isGameIconsPage()
              ? "game-icons"
              : "admin",
        };
      }
      if (msg?.type === "LOG_OPEN") {
        S.openLogPanel(msg.title || "L-Fight Autofill · Gemini");
        return { ok: true };
      }
      if (msg?.type === "LOG") {
        S.appendLog(msg.text || "", Boolean(msg.error));
        return { ok: true };
      }
      if (msg?.type === "LOG_CLOSE") {
        S.closeLogPanel(Number(msg.delayMs) || 0);
        return { ok: true };
      }
      if (msg?.type === "SET_BUSY") {
        setBusy(Boolean(msg.busy));
        return { ok: true };
      }
      if (msg?.type === "CLEAR_ERRORS") {
        clearAdminErrors();
        return { ok: true };
      }
      if (msg?.type === "GET_LOCAL_512") {
        return await readLocal512();
      }
      if (msg?.type === "GET_S3_512") {
        return await readS3FromPage();
      }
      if (msg?.type === "SKIP_RETOUCH") {
        return await skipRetouchToNext();
      }
      if (msg?.type === "SHOW_RETOUCH_ERROR") {
        reportRetouchError(msg.error || "Не удалось применить новую картинку");
        return { ok: true };
      }
      if (msg?.type === "SAVE_RETOUCH") {
        return await saveRetouchAndAdvance({
          imageBase64: msg.imageBase64,
          mime: msg.mime,
          expectedFingerprint: msg.expectedFingerprint || null,
          expectedPixels: msg.expectedPixels || null,
          advance: msg.advance !== false,
        });
      }
      if (msg?.type === "GET_PROMPT") {
        clearAdminErrors();
        const data = await waitForPrompt(null, 5000).catch(() => ({
          prompt: getPrompt(),
          icon: getEditorIcon(),
        }));
        if (!data.prompt) throw new Error("Промпт пуст — выберите иконку");
        return { ok: true, ...data };
      }
      if (msg?.type === "SKIP_TO_NEXT") {
        return await skipToNextIcon();
      }
      if (msg?.type === "SAVE_RAW") {
        return await saveRawAndAdvance({
          imageBase64: msg.imageBase64,
          mime: msg.mime,
          expectedFingerprint: msg.expectedFingerprint || null,
          advance: msg.advance !== false,
        });
      }
      if (msg?.type === "UPLOAD_QUARTER") {
        if (!msg.imageBase64) throw new Error("Нет изображения четверти");
        const blob = S.base64ToBlob(
          msg.imageBase64,
          msg.mime || "image/jpeg",
        );
        if (!blob?.size) throw new Error("Пустая четверть");
        window.dispatchEvent(
          new CustomEvent("l-fight-admin-upload-quarter", {
            detail: { blob, corner: String(msg.corner || "") },
            bubbles: true,
          }),
        );
        return { ok: true, size: blob.size };
      }
      if (msg?.type === "UPLOAD_IMAGE") {
        let blob = null;
        if (msg.imageBase64) {
          blob = S.base64ToBlob(
            msg.imageBase64,
            msg.mime || "image/jpeg",
          );
        } else if (msg.imageBuffer) {
          const raw = msg.imageBuffer;
          const u8 =
            raw instanceof ArrayBuffer
              ? new Uint8Array(raw)
              : ArrayBuffer.isView(raw)
                ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
                : Array.isArray(raw)
                  ? new Uint8Array(raw)
                  : null;
          if (!u8?.length) throw new Error("Пустой imageBuffer");
          const sniffed = S.sniffImageMime(u8) || msg.mime || "image/jpeg";
          blob = new Blob([u8], { type: sniffed });
        }
        if (!blob || !blob.size) {
          throw new Error("Нет image blob для upload");
        }
        if (blob.type !== "image/jpeg") {
          const jpeg = await S.transcodeToJpeg(blob, blob.type);
          blob = jpeg.blob;
          S.appendLog(
            `Transcode→JPEG ${jpeg.width}×${jpeg.height}, ${Math.round(jpeg.size / 1024)} KB`,
          );
        } else {
          const head = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
          if (!(head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)) {
            const jpeg = await S.transcodeToJpeg(blob, "image/jpeg");
            blob = jpeg.blob;
            S.appendLog(
              `Re-encode JPEG ${jpeg.width}×${jpeg.height} (битый magic)`,
            );
          }
        }
        S.appendLog(`Upload в админку: ${Math.round(blob.size / 1024)} KB`);
        dispatchUploadImage(blob);
        await S.sleep(600);
        return { ok: true, size: blob.size };
      }
      return { ok: false, error: "unknown message" };
    })()
      .then(sendResponse)
      .catch((err) =>
        sendResponse({ ok: false, error: err?.message || String(err) }),
      );
    return true;
  });

  ensureIconsPanel();
  ensureRetouchPanel();
  new MutationObserver(() => {
    ensureIconsPanel();
    ensureRetouchPanel();
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
