(() => {
  const S = globalThis.LFightExt;

  function firstUserQuery() {
    return document.querySelector("user-query") || null;
  }

  /** Кнопка «Изменить» только у верхнего user-query (не composer). */
  function editButton() {
    const host = firstUserQuery();
    if (!host) return null;
    const wrap =
      host.querySelector('[data-test-id="prompt-edit-button"]') ||
      host.querySelector('gem-icon-button[arialabel="Изменить"]');
    if (!wrap) return null;
    if (wrap.classList.contains("gem-button-disabled")) return null;
    if (wrap.hasAttribute("inert")) return null;
    const btn = wrap.querySelector("button") || wrap;
    if (btn.disabled || btn.getAttribute("disabled") != null) return null;
    return btn;
  }

  /**
   * Поле правки предыдущего запроса внутри user-query.edit-mode.
   * НЕ путать с нижним composer (aria тоже «Введите запрос для Gemini»).
   */
  function editQueryEditor() {
    const uq = firstUserQuery();
    if (!uq) return null;
    if (!uq.querySelector("user-query-content.edit-mode")) return null;
    return (
      uq.querySelector(
        'rich-textarea.edit-rich-textarea .ql-editor[contenteditable="true"]',
      ) ||
      uq.querySelector(
        'rich-textarea[aria-label="Изменить запрос"] .ql-editor[contenteditable="true"]',
      ) ||
      uq.querySelector(
        'user-query-content.edit-mode .ql-editor[contenteditable="true"]',
      ) ||
      null
    );
  }

  function updateButton() {
    const uq = firstUserQuery();
    const scope = uq || document;
    const host = scope.querySelector("gem-button.update-button");
    if (!host) return null;
    if (host.classList.contains("gem-button-disabled")) return null;
    const btn = host.querySelector("button") || host;
    if (btn.disabled || btn.getAttribute("disabled") != null) return null;
    if (btn.classList?.contains("mat-mdc-button-disabled")) return null;
    return btn;
  }

  /** Клик по host gem-icon-button (надёжнее, чем только inner button). */
  function clickEditButton() {
    const host =
      document.querySelector('[data-test-id="prompt-edit-button"]') ||
      document.querySelector('gem-icon-button[arialabel="Изменить"]');
    if (!host) return false;
    if (host.classList.contains("gem-button-disabled")) return false;
    if (host.hasAttribute("inert")) return false;
    S.clickEl(host);
    const inner = host.querySelector("button");
    if (inner && inner !== host) S.clickEl(inner);
    return true;
  }

  function getQuill(editor) {
    if (!editor) return null;
    const rich = editor.closest("rich-textarea");
    try {
      if (rich?.__quill) return rich.__quill;
      if (editor.__quill) return editor.__quill;
      if (globalThis.Quill?.find) return globalThis.Quill.find(editor);
    } catch {
      /* ignore */
    }
    return null;
  }

  function imageBitmapReady(img) {
    return (img?.naturalWidth || 0) >= 64 && (img?.naturalHeight || 0) >= 64;
  }

  function loadedImage() {
    const imgs = [...document.querySelectorAll("generated-image img")];
    return (
      imgs.find(
        (img) => img.classList.contains("loaded") && imageBitmapReady(img),
      ) ||
      imgs.find((img) => imageBitmapReady(img)) ||
      null
    );
  }

  function imageSrc(el) {
    const current = (el?.currentSrc || "").trim();
    const attr = (el?.getAttribute("src") || "").trim();
    return current || attr;
  }

  function isUsableImageSrc(src) {
    if (!src) return false;
    return (
      src.startsWith("blob:") ||
      src.startsWith("https://lh3.googleusercontent.com/") ||
      src.startsWith("https://")
    );
  }

  function downloadFullButton() {
    const host =
      document.querySelector(
        '[data-test-id="download-generated-image-button"]',
      ) ||
      document.querySelector(
        'gem-icon-button[arialabel="Скачать изображение в полном размере"]',
      );
    if (!host) return null;
    return host.querySelector("button") || host;
  }

  /** Кнопка «Копировать изображение» у готовой картинки (иконки → буфер). */
  function copyImageButton() {
    const byTest =
      document.querySelector(
        '[data-test-id="copy-generated-image-button"]',
      ) ||
      document.querySelector(
        'gem-icon-button[arialabel="Копировать изображение"]',
      ) ||
      document.querySelector('gem-icon-button[arialabel="Copy image"]');
    if (byTest) return byTest.querySelector("button") || byTest;
    const byLabel = [...document.querySelectorAll("button, [role='button']")].find(
      (el) => {
        if (!S.visible(el)) return false;
        const t = S.btnText(el);
        const aria = (
          el.getAttribute("aria-label") ||
          el.getAttribute("arialabel") ||
          ""
        ).trim();
        return (
          /Копировать изображение/i.test(t) ||
          /Копировать изображение/i.test(aria) ||
          /^Copy image$/i.test(t) ||
          /^Copy image$/i.test(aria)
        );
      },
    );
    return byLabel || null;
  }

  function isGenerating() {
    const thinking = document.querySelector(
      '[data-test-id="thinking-overlay-content"]',
    );
    if (
      thinking &&
      /Создание изображения/i.test(thinking.textContent || "")
    ) {
      return true;
    }
    if (
      document.querySelector(
        ".image-gen-shimmer-placeholder.gem-shimmer-active",
      )
    ) {
      return true;
    }
    const busy = document.querySelector(
      '.model-response-label-announcer[aria-busy="true"]',
    );
    return Boolean(busy);
  }

  function textLooksInserted(editor, text) {
    const head = text.slice(0, Math.min(32, text.length)).replace(/\s+/g, " ").trim();
    const needle = head.slice(0, 16);
    if (!needle) return true;
    const current = (editor.textContent || "").replace(/\s+/g, " ").trim();
    return current.includes(needle);
  }

  function clearEditor(editor) {
    const quill = getQuill(editor);
    if (quill?.setText) {
      try {
        quill.setText("\n");
        return;
      } catch {
        /* fallthrough */
      }
    }
    editor.focus();
    try {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
    } catch {
      /* ignore */
    }
    if ((editor.textContent || "").trim()) {
      editor.innerHTML = "<p><br></p>";
      editor.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "deleteContent" }),
      );
    }
  }

  function insertViaQuill(editor, text) {
    const quill = getQuill(editor);
    if (!quill?.setText) return false;
    try {
      quill.setText(`${text}\n`);
      // text-change — Angular/Gemini часто слушает именно Quill events.
      try {
        quill.emitter?.emit?.("text-change");
      } catch {
        /* ignore */
      }
      editor.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertFromPaste",
          data: text,
        }),
      );
      return textLooksInserted(editor, text);
    } catch {
      return false;
    }
  }

  function insertViaPasteEvent(editor, text) {
    editor.focus();
    try {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
    } catch {
      /* ignore */
    }
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      const paste = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      const ok = editor.dispatchEvent(paste);
      if (!textLooksInserted(editor, text)) {
        // Quill иногда жрёт paste только через execCommand
        document.execCommand("insertText", false, text);
      }
      return ok || textLooksInserted(editor, text);
    } catch {
      return false;
    }
  }

  function insertViaExec(editor, text) {
    editor.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    sel.removeAllRanges();
    sel.addRange(range);
    try {
      return Boolean(document.execCommand("insertText", false, text));
    } catch {
      return false;
    }
  }

  function insertViaDom(editor, text) {
    editor.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = text;
    editor.appendChild(p);
    editor.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertFromPaste",
        data: text,
      }),
    );
    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertFromPaste",
        data: text,
      }),
    );
    editor.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * Как ручной клик мышью: Angular/Quill часто не «видит» один .focus()
   * и «Обновить» остаётся disabled, пока пользователь не кликнет в поле.
   */
  async function focusEditorViaClick(editor) {
    if (!editor) return;
    const host =
      editor.closest("rich-textarea") ||
      editor.closest("user-query-content") ||
      editor;
    editor.scrollIntoView({ block: "center", inline: "nearest" });
    S.clickEl(host);
    await S.sleep(80);
    if (host !== editor) S.clickEl(editor);
    try {
      editor.focus({ preventScroll: true });
    } catch {
      editor.focus();
    }
    // focusin/focus — на случай слушателей Angular
    editor.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    editor.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    await S.sleep(120);
  }

  /** Каретка в конец Quill-редактора. */
  function placeCaretAtEnd(editor) {
    try {
      editor.focus({ preventScroll: true });
    } catch {
      editor.focus();
    }
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /**
   * Реальное изменение текста (пробел в конце) — иначе «Обновить» часто
   * остаётся disabled после программного paste, пока вручную не тронешь поле.
   */
  function appendTrailingSpace(editor) {
    placeCaretAtEnd(editor);
    try {
      document.execCommand("insertText", false, " ");
    } catch {
      /* ignore */
    }
    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: " ",
      }),
    );
    editor.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * Живой клик в поле после программной вставки — без него «Обновить»
   * часто остаётся disabled (проверено на реальной вкладке Gemini).
   */
  async function nudgeUntilUpdateEnabled(editor, attempts = 5) {
    for (let i = 0; i < attempts; i++) {
      if (updateButton()) {
        S.appendLog("«Обновить» уже enabled");
        return true;
      }
      S.appendLog(
        i === 0
          ? "Повторный клик в edit-box (разблокировка «Обновить»)…"
          : `Разблокировка «Обновить» (попытка ${i + 1})…`,
      );
      await focusEditorViaClick(editor);
      // Чередуем: клик-пауза / клик+пробел — оба пути встречались в UI.
      if (i % 2 === 1) appendTrailingSpace(editor);
      await S.sleep(S.GAP_AFTER_INSERT_MS);
      if (updateButton()) {
        S.appendLog("«Обновить» разблокирована");
        return true;
      }
    }
    return Boolean(updateButton());
  }

  async function setEditorText(editor, text) {
    await focusEditorViaClick(editor);
    clearEditor(editor);
    await S.sleep(S.GAP_PHASE_MS);

    S.appendLog(`Вставка промпта (${text.length} символов)…`);
    await focusEditorViaClick(editor);

    let ok = insertViaQuill(editor, text);
    if (ok) S.appendLog("Вставка через Quill.setText");
    await S.sleep(S.GAP_PHASE_MS);

    if (!ok || !textLooksInserted(editor, text)) {
      S.appendLog("fallback: ClipboardEvent paste…");
      await focusEditorViaClick(editor);
      ok = insertViaPasteEvent(editor, text);
      await S.sleep(S.GAP_PHASE_MS);
    }

    if (!ok || !textLooksInserted(editor, text)) {
      S.appendLog("fallback: execCommand insertText…");
      await focusEditorViaClick(editor);
      ok = insertViaExec(editor, text);
      await S.sleep(S.GAP_PHASE_MS);
    }

    if (!ok || !textLooksInserted(editor, text)) {
      S.appendLog("fallback: DOM + InputEvent…");
      await focusEditorViaClick(editor);
      insertViaDom(editor, text);
      await S.sleep(S.GAP_PHASE_MS);
    }

    if (!textLooksInserted(editor, text)) {
      throw new Error("Текст не попал в edit-box");
    }
    S.appendLog(
      `Промпт в поле: «${(editor.textContent || "").trim().slice(0, 48)}…»`,
    );

    await S.sleep(S.GAP_PHASE_MS);
    await nudgeUntilUpdateEnabled(editor);
  }

  /**
   * Фаза 1: гарантированно открыть edit-mode верхнего user-query.
   * Без этого текст уходит в нижний composer (новое сообщение).
   * После EDIT_OPEN_ATTEMPTS неудач — NEED_PAGE_RELOAD (background reload).
   */
  const EDIT_OPEN_ATTEMPTS = 3;

  async function ensureEditModeOpen() {
    for (let attempt = 1; attempt <= EDIT_OPEN_ATTEMPTS; attempt++) {
      let editor = editQueryEditor();
      if (editor) {
        S.appendLog(
          attempt === 1
            ? "Уже в edit-mode — проверяю поле"
            : `edit-mode открыт (попытка ${attempt})`,
        );
        await S.sleep(S.GAP_PHASE_MS);
        editor = editQueryEditor();
        if (editor) return editor;
        S.appendLog("edit-mode пропал сразу после паузы — повтор…", true);
      }

      S.appendLog(
        attempt === 1
          ? "Клик «Изменить» (верхний запрос)"
          : `Повтор клика «Изменить» (${attempt}/${EDIT_OPEN_ATTEMPTS})…`,
      );
      await S.waitFor(() => editButton(), S.WAIT_EDIT_MS, "кнопка «Изменить»");
      await S.sleep(S.GAP_PHASE_MS);
      if (!clickEditButton()) {
        const btn = editButton();
        if (btn) S.clickEl(btn);
      }
      await S.sleep(S.GAP_PHASE_MS);

      editor = editQueryEditor();
      if (editor) {
        S.appendLog("edit-mode подтверждён");
        await S.sleep(S.GAP_PHASE_MS);
        editor = editQueryEditor();
        if (editor) return editor;
      }

      S.appendLog(
        `edit-mode не открылся (${attempt}/${EDIT_OPEN_ATTEMPTS})`,
        true,
      );
      await S.sleep(S.GAP_PHASE_MS);
    }

    throw new Error(
      `NEED_PAGE_RELOAD: edit-mode не открылся после ${EDIT_OPEN_ATTEMPTS} попыток «Изменить»`,
    );
  }

  /**
   * Фаза 2: заменить текст только в edit-box (не composer) и подтвердить.
   */
  async function replaceEditPrompt(text) {
    const REPLACE_ATTEMPTS = 3;
    let lastErr = null;
    for (let attempt = 1; attempt <= REPLACE_ATTEMPTS; attempt++) {
      const editor = editQueryEditor();
      if (!editor) {
        lastErr = new Error("edit-mode закрыт до вставки текста");
        S.appendLog(lastErr.message, true);
        await ensureEditModeOpen();
        continue;
      }

      S.appendLog(
        attempt === 1
          ? "Вставляю промпт в edit-box…"
          : `Повтор вставки промпта (${attempt}/${REPLACE_ATTEMPTS})…`,
      );
      try {
        await S.withTimeout(
          setEditorText(editor, text),
          S.WAIT_INSERT_MS,
          "вставка промпта в edit-box",
        );
      } catch (err) {
        S.rethrowIfStepRetry(err);
        lastErr = err;
        S.appendLog(err?.message || String(err), true);
        await S.sleep(S.GAP_PHASE_MS);
        continue;
      }

      await S.sleep(S.GAP_PHASE_MS);
      const after = editQueryEditor();
      if (!after) {
        lastErr = new Error("edit-mode закрылся после вставки (текст мог уйти в composer)");
        S.appendLog(lastErr.message, true);
        await ensureEditModeOpen();
        continue;
      }
      if (!textLooksInserted(after, text)) {
        lastErr = new Error("Текст в edit-box не подтверждён");
        S.appendLog(lastErr.message, true);
        await S.sleep(S.GAP_PHASE_MS);
        continue;
      }

      S.appendLog("Текст в edit-box подтверждён");
      return after;
    }

    throw new Error(
      `NEED_PAGE_RELOAD: не удалось заменить текст в edit-box (${lastErr?.message || "unknown"})`,
    );
  }

  async function waitForReplacedImage(prevSrc, timeoutMs = S.WAIT_GEN_MS) {
    const start = Date.now();
    let brokenSince = 0;
    let retries = 0;
    while (Date.now() - start < timeoutMs) {
      if (isGenerating()) {
        brokenSince = 0;
      } else {
        const ready = findNewGeneratedImage(prevSrc ? [prevSrc] : []);
        if (ready) return ready;
        const broken = findBrokenGeneratedImage(prevSrc ? [prevSrc] : []);
        if (broken) {
          if (!brokenSince) brokenSince = Date.now();
          if (Date.now() - brokenSince >= 3000 && retries < 2) {
            retries += 1;
            brokenSince = 0;
            await clickRetryGeneration();
          }
        } else {
          brokenSince = 0;
        }
      }
      await S.sleep(S.STEP_MS);
    }
    throw new Error("готовое изображение Gemini");
  }

  async function editAndGenerate(prompt, options = {}) {
    const text = String(prompt || "").trim();
    if (!text) throw new Error("Пустой промпт");
    const waitMs =
      Number(options.waitMs) > 0
        ? Number(options.waitMs)
        : options.imageTimeout === "restart"
          ? S.ICON_WAIT_IMAGE_MS
          : S.WAIT_GEN_MS;

    const prevSrc = imageSrc(loadedImage());
    const uq = firstUserQuery();
    if (uq) uq.scrollIntoView({ block: "center", inline: "nearest" });
    await S.sleep(S.GAP_PHASE_MS);

    // Фаза 1: «Изменить» → edit-mode (иначе текст уйдёт в новое сообщение).
    let editor = await ensureEditModeOpen();

    // Фаза 2: заменить содержимое edit-box и подтвердить.
    editor = await replaceEditPrompt(text);
    S.appendLog("Промпт вставлен, жду «Обновить»…");
    await S.sleep(S.GAP_PHASE_MS);

    // Фаза 3: только после подтверждённой замены — клик «Обновить».
    editor = editQueryEditor() || editor;
    if (!editQueryEditor()) {
      throw new Error(
        "NEED_PAGE_RELOAD: edit-mode пропал перед «Обновить»",
      );
    }
    if (!updateButton()) {
      await nudgeUntilUpdateEnabled(editor, 3);
    }

    await S.waitFor(
      () => updateButton(),
      S.WAIT_EDIT_MS,
      "кнопка «Обновить» (enabled)",
    );
    await S.sleep(S.GAP_PHASE_MS);

    /**
     * Клик «Обновить» иногда «проглатывается» (лог есть, UI не ушёл из edit-mode).
     * Успех = edit-mode закрыт ИЛИ идёт генерация; иначе ретрай.
     */
    const UPDATE_CLICK_ATTEMPTS = 2;
    const UPDATE_CONFIRM_MS = 4500;
    let updateAccepted = false;
    for (let attempt = 1; attempt <= UPDATE_CLICK_ATTEMPTS; attempt++) {
      if (!editQueryEditor() && (isGenerating() || !document.querySelector("user-query-content.edit-mode"))) {
        updateAccepted = true;
        S.appendLog("«Обновить» уже принят (edit-mode закрыт)");
        break;
      }

      const btn = updateButton();
      if (!btn) {
        // Кнопка пропала — возможно уже ушли из edit-mode.
        if (
          isGenerating() ||
          !document.querySelector("user-query-content.edit-mode")
        ) {
          updateAccepted = true;
          S.appendLog("«Обновить» уже принят (кнопка исчезла)");
          break;
        }
        throw new Error("Кнопка «Обновить» пропала до клика");
      }

      S.appendLog(
        attempt === 1
          ? "Клик «Обновить»"
          : `Повтор клика «Обновить» (${attempt}/${UPDATE_CLICK_ATTEMPTS})…`,
      );
      const updateHost = document.querySelector("gem-button.update-button");
      if (updateHost) {
        updateHost.scrollIntoView({ block: "center", inline: "nearest" });
        S.clickEl(updateHost);
      }
      S.clickEl(btn);
      // Нативный click ещё раз на inner button (иногда synthetic sequence мало).
      try {
        btn.click();
      } catch {
        /* ignore */
      }

      await S.sleep(S.GAP_PHASE_MS);

      const confirmStart = Date.now();
      while (Date.now() - confirmStart < UPDATE_CONFIRM_MS) {
        if (isGenerating()) {
          updateAccepted = true;
          break;
        }
        if (!document.querySelector("user-query-content.edit-mode")) {
          updateAccepted = true;
          break;
        }
        await S.sleep(S.STEP_MS);
      }

      if (updateAccepted) {
        S.appendLog(
          isGenerating()
            ? "Клик «Обновить» принят — идёт генерация"
            : "Клик «Обновить» принят — edit-mode закрыт",
        );
        break;
      }

      S.appendLog(
        `Клик «Обновить» не принят (всё ещё edit-mode)…`,
        true,
      );
      // Перед ретраем снова фокус в поле — иногда кнопка «залипает».
      const ed = editQueryEditor();
      if (ed) {
        await focusEditorViaClick(ed);
        await S.sleep(S.GAP_PHASE_MS);
      }
    }

    if (!updateAccepted) {
      throw new Error(
        `NEED_PAGE_RELOAD: клик «Обновить» не сработал после ${UPDATE_CLICK_ATTEMPTS} попыток`,
      );
    }

    S.appendLog("Жду готовое изображение…");

    let img;
    try {
      img = await waitForReplacedImage(prevSrc, waitMs);
    } catch (err) {
      S.rethrowIfStepRetry(err);
      const msg = err?.message || String(err);
      if (options.imageTimeout === "restart") {
        throw new Error(`RESTART_CYCLE: изображение не появилось (${msg})`);
      }
      throw new Error(
        `NEED_PAGE_RELOAD: изображение не сгенерировалось (${msg})`,
      );
    }

    S.appendLog("Изображение готово");
    return {
      ok: true,
      imageSrc: imageSrc(img),
    };
  }

  /** Сообщения из MAIN-world перехватчика (background inject). */
  const MAIN_BLOB_MSG = "__LFIGHT_BLOB_CAP__";

  /**
   * Слушаем postMessage из MAIN world (createObjectURL / fetch blob:href).
   * Isolated-world fetch(blob:) и patch URL.createObjectURL не работают на Gemini.
   */
  function armImageBlobCapture(timeoutMs = S.WAIT_DOWNLOAD_MS) {
    let settled = false;
    let timer = null;
    let resolveFn = () => {};
    let rejectFn = () => {};

    const promise = new Promise((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const finish = (base64, mime, via, size) => {
      if (settled || !base64) return;
      const sz = size || 0;
      if (sz < 5_000 && base64.length < 6_000) return;
      // async decode→JPEG; мелкие/битые кандидаты пропускаем
      void (async () => {
        if (settled) return;
        try {
          const jpeg = await S.transcodeToJpeg(base64, mime || "image/png");
          if (jpeg.width < 256 || jpeg.height < 256) {
            S.appendLog(
              `skip ${via}: ${jpeg.width}×${jpeg.height} (похоже на превью)`,
              true,
            );
            return;
          }
          if (settled) return;
          settled = true;
          cleanup();
          S.appendLog(
            `JPEG ${jpeg.width}×${jpeg.height}, ${Math.round(jpeg.size / 1024)} KB (${via})`,
          );
          resolveFn({
            imageBase64: jpeg.imageBase64,
            mime: "image/jpeg",
            via,
            size: jpeg.size,
            width: jpeg.width,
            height: jpeg.height,
          });
        } catch (err) {
          S.appendLog(
            `skip blob (${via}): ${err?.message || err}`,
            true,
          );
        }
      })();
    };

    const onMessage = (ev) => {
      if (ev.source !== window) return;
      const data = ev.data;
      if (!data || data.source !== MAIN_BLOB_MSG) return;
      try {
        if (data.base64) {
          finish(data.base64, data.mime, data.via || "main", data.size);
          return;
        }
        // legacy ArrayBuffer path
        if (data.buffer) {
          const u8 = new Uint8Array(data.buffer);
          finish(
            S.uint8ToBase64(u8),
            data.mime || S.sniffImageMime(u8) || "image/png",
            data.via || "main",
            data.size || u8.byteLength,
          );
        }
      } catch {
        /* ignore */
      }
    };

    const cleanup = () => {
      window.removeEventListener("message", onMessage, true);
      if (timer) clearTimeout(timer);
    };

    window.addEventListener("message", onMessage, true);

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectFn(new Error("Таймаут перехвата full-size blob (MAIN)"));
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

  async function clickDownloadFullAndCapture() {
    const btn = await S.waitFor(
      () => downloadFullButton(),
      15000,
      "«Скачать в полном размере»",
    );
    S.appendLog("Клик «Скачать в полном размере» + MAIN blob capture");
    const capture = armImageBlobCapture(S.WAIT_DOWNLOAD_MS);
    await S.sleep(S.GAP_MS);
    S.clickEl(btn);
    try {
      const payload = await capture.promise;
      S.appendLog(
        `Blob→JPEG (${payload.via}, ${Math.round(payload.size / 1024)} KB)`,
      );
      return { ok: true, ...payload };
    } catch (err) {
      capture.disarm();
      throw err;
    }
  }

  /**
   * Клик «Копировать изображение» → JPEG base64 + fingerprint из буфера.
   * Для иконок уменьшенный кадр ок (админка кропает/апскейлит до 512).
   */
  async function clickCopyImageAndCapture() {
    const before = await S.readClipboardFingerprint(1024);
    const btn = await S.waitFor(
      () => copyImageButton(),
      20000,
      "«Копировать изображение»",
    );
    S.appendLog("Клик «Копировать изображение»");
    await S.sleep(S.GAP_MS);
    S.clickEl(btn);

    const start = Date.now();
    let lastReason = "пусто";
    while (Date.now() - start < 25000) {
      const info = await S.readClipboardImageBlob(1500);
      if (!info.ok || !info.blob) {
        lastReason = info.reason || "нет image";
        await S.sleep(400);
        continue;
      }
      const fpRaw = await S.fingerprintBlob(info.blob);
      if (before.ok && before.fingerprint && fpRaw === before.fingerprint) {
        lastReason = "буфер ещё старый";
        await S.sleep(400);
        continue;
      }
      const jpeg = await S.transcodeToJpeg(info.blob, info.type || "image/png");
      if (jpeg.width < 64 || jpeg.height < 64) {
        lastReason = `слишком маленький ${jpeg.width}×${jpeg.height}`;
        await S.sleep(400);
        continue;
      }
      const fingerprint = await S.fingerprintBlob(jpeg.blob);
      S.appendLog(
        `Clipboard→JPEG ${jpeg.width}×${jpeg.height}, ${Math.round(jpeg.size / 1024)} KB fp=${fingerprint}`,
      );
      return {
        ok: true,
        imageBase64: jpeg.imageBase64,
        mime: "image/jpeg",
        fingerprint,
        size: jpeg.size,
        width: jpeg.width,
        height: jpeg.height,
        via: "copy-image",
      };
    }
    throw new Error(
      `Таймаут: «Копировать изображение» не дало свежий буфер (${lastReason})`,
    );
  }

  async function fetchUrlAsBuffer(url) {
    const u = String(url || "");
    // blob: из content script / SW нельзя — только https(s) (googleusercontent и т.п.)
    if (!u || u.startsWith("blob:")) {
      throw new Error(
        "blob: URL нельзя fetch из content script (нужен MAIN capture)",
      );
    }
    if (!/^https?:\/\//i.test(u)) {
      throw new Error(`Неподдерживаемый URL скачивания: ${u.slice(0, 64)}`);
    }
    const res = await fetch(u, { credentials: "include" });
    if (!res.ok) throw new Error(`fetch URL failed: ${res.status}`);
    const blob = await res.blob();
    if (!blob?.size) throw new Error("Пустой blob по URL скачивания");
    const jpeg = await S.transcodeToJpeg(blob, blob.type || "image/png");
    return {
      ok: true,
      imageBase64: jpeg.imageBase64,
      mime: "image/jpeg",
      size: jpeg.size,
      width: jpeg.width,
      height: jpeg.height,
    };
  }

  /** Нижний composer (новое сообщение), не edit-box предыдущего запроса. */
  function composerEditor() {
    const all = [
      ...document.querySelectorAll(
        '.ql-editor[contenteditable="true"]',
      ),
    ];
    const bottom = all.filter((el) => !el.closest("user-query"));
    return bottom[bottom.length - 1] || null;
  }

  function composerRoot() {
    const editor = composerEditor();
    if (!editor) return null;
    let node = editor;
    for (let i = 0; i < 12 && node; i++) {
      const tag = (node.tagName || "").toLowerCase();
      const cls = typeof node.className === "string" ? node.className : "";
      const testId = node.getAttribute?.("data-test-id") || "";
      if (
        tag === "input-area" ||
        tag === "form" ||
        /input-area|input-container|prompt-input|chat-input/i.test(cls) ||
        /input/i.test(testId)
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return editor.parentElement?.parentElement || editor;
  }

  function composerAttachmentCount() {
    const root = composerRoot() || document;
    const chips = [
      ...root.querySelectorAll(
        "uploader-file-preview, .file-preview-chip, .attachment-preview-wrapper",
      ),
    ];
    return chips.filter(
      (el) => !chips.some((other) => other !== el && other.contains(el)),
    ).length;
  }

  function composerSendButton() {
    return (
      [...document.querySelectorAll("button")].find((el) => {
        if (!S.visible(el) || el.disabled) return false;
        if (el.getAttribute("aria-disabled") === "true") return false;
        if (el.classList?.contains("mat-mdc-button-disabled")) return false;
        const aria = (
          el.getAttribute("aria-label") ||
          el.getAttribute("arialabel") ||
          ""
        ).trim();
        return /^Отправить сообщение$|^Send message$/i.test(aria);
      }) || null
    );
  }

  function userQueryCount() {
    return document.querySelectorAll("user-query").length;
  }

  async function dismissComposerMenus() {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
      }),
    );
    await S.sleep(200);
  }

  function promptStillInComposer(promptText) {
    const needle = String(promptText || "").trim().slice(0, 48);
    if (!needle) return false;
    return String(composerEditor()?.textContent || "").includes(needle);
  }

  /**
   * afterClick: чип Gemini снимает сразу, а user-query и оверлей — позже.
   * Текст ещё в поле не отменяет уже начатую генерацию.
   */
  function sendWasAccepted(beforeQueries, beforeSrcs, promptText, afterClick) {
    const promptLeft = !promptStillInComposer(promptText);
    if (isGenerating() && (afterClick || promptLeft)) return "generation";
    if (userQueryCount() > beforeQueries) return "query";
    if (findNewGeneratedImage(beforeSrcs)) return "image";
    // После клика чип уходит в сообщение раньше, чем очищается поле и появляется оверлей.
    if (afterClick && composerAttachmentCount() < 1) return "sent";
    if (!promptLeft) return "";
    return "";
  }

  async function clickComposerSend(promptText) {
    await dismissComposerMenus();
    const beforeQueries = userQueryCount();
    const beforeSrcs = snapshotGeneratedSrcs();
    let clicked = false;
    const start = Date.now();
    const acceptedNow = () =>
      sendWasAccepted(beforeQueries, beforeSrcs, promptText, clicked);
    while (Date.now() - start < 20000) {
      if (!clicked && composerAttachmentCount() < 1) {
        throw new Error("Картинка пропала из нового чата до отправки");
      }
      const accepted = acceptedNow();
      if (accepted) {
        await S.sleep(700);
        const again = acceptedNow();
        if (again) {
          S.appendLog(
            again === "query" || again === "image"
              ? "Клик отправки"
              : "Отправка принята — идёт генерация",
          );
          return;
        }
      }
      // Клик уже был: чип ушёл в сообщение. Повторный клик или throw
      // открывают новый чат поверх уже идущей генерации.
      if (clicked && composerAttachmentCount() < 1) {
        await S.sleep(400);
        continue;
      }
      const btn = composerSendButton();
      if (btn) {
        clicked = true;
        btn.scrollIntoView({ block: "center", inline: "nearest" });
        S.appendLog("Клик «Отправить сообщение»");
        S.clickEl(btn);
        try {
          btn.click();
        } catch {
          /* ignore */
        }
        const touch = btn.querySelector(".mat-mdc-button-touch-target");
        if (touch) {
          S.clickEl(touch);
          try {
            touch.click();
          } catch {
            /* ignore */
          }
        }
        await S.sleep(800);
        if (
          composerEditor() &&
          !acceptedNow() &&
          composerAttachmentCount() > 0
        ) {
          const editor = composerEditor();
          editor.focus();
          const key = {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          };
          editor.dispatchEvent(new KeyboardEvent("keydown", key));
          editor.dispatchEvent(new KeyboardEvent("keyup", key));
          await S.sleep(800);
        }
        if (!acceptedNow()) {
          S.appendLog("Кнопка «Отправить» ещё не сработала, повтор");
        }
      }
      await S.sleep(300);
    }
    if (acceptedNow()) {
      S.appendLog("Отправка принята — идёт генерация");
      return;
    }
    if (clicked && composerAttachmentCount() < 1 && !promptStillInComposer(promptText)) {
      S.appendLog("Отправка принята — идёт генерация");
      return;
    }
    if (promptStillInComposer(promptText)) {
      throw new Error("Промпт всё ещё в поле — отправка не прошла");
    }
    throw new Error("Кнопка «Отправить» не сработала");
  }

  function imageFileInput() {
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    return (
      inputs.find((el) =>
        (el.getAttribute("accept") || "").toLowerCase().includes("image"),
      ) ||
      inputs.find((el) => {
        const accept = (el.getAttribute("accept") || "").toLowerCase();
        return !accept || /png|jpe?g|webp/.test(accept);
      }) ||
      null
    );
  }

  async function ensureImageFileInput() {
    const existing = imageFileInput();
    if (existing) return existing;
    const tools = [...document.querySelectorAll("button")].find((el) => {
      const label = (
        el.getAttribute("aria-label") ||
        el.textContent ||
        ""
      ).trim();
      return /Загрузка и инструменты|Upload and tools|Add files|Добавить файлы/i.test(
        label,
      );
    });
    if (!tools) return null;
    S.clickEl(tools);
    try {
      tools.click();
    } catch {
      /* ignore */
    }
    const start = Date.now();
    while (Date.now() - start < 4000) {
      const input = imageFileInput();
      if (input) return input;
      await S.sleep(200);
    }
    return null;
  }

  async function waitComposerEditor(timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const editor = composerEditor();
      if (editor) return editor;
      await S.sleep(250);
    }
    return null;
  }

  function generatedImageEls() {
    return [...document.querySelectorAll("generated-image img")].filter((img) =>
      isUsableImageSrc(imageSrc(img)),
    );
  }

  function snapshotGeneratedSrcs() {
    return generatedImageEls().map((img) => imageSrc(img));
  }

  function imageBitmapBroken(img) {
    return Boolean(img?.complete) && (img.naturalWidth || 0) === 0;
  }

  function freshGeneratedImages(prevSrcs) {
    const prev = new Set(prevSrcs || []);
    return generatedImageEls().filter((img) => !prev.has(imageSrc(img)));
  }

  function findNewGeneratedImage(prevSrcs) {
    const loaded = freshGeneratedImages(prevSrcs).filter(imageBitmapReady);
    return loaded[loaded.length - 1] || null;
  }

  function findBrokenGeneratedImage(prevSrcs) {
    const broken = freshGeneratedImages(prevSrcs).filter(imageBitmapBroken);
    return broken[broken.length - 1] || null;
  }

  function retryGenerationButton() {
    const matches = [...document.querySelectorAll("button")].filter((el) => {
      if (!S.visible(el)) return false;
      const aria = (el.getAttribute("aria-label") || "").trim();
      return /^Повторить$|^Retry$|^Regenerate$/i.test(aria);
    });
    return matches[matches.length - 1] || null;
  }

  async function clickRetryGeneration() {
    const btn = retryGenerationButton();
    if (!btn) throw new Error("Нет кнопки «Повторить»");
    S.appendLog("Картинка не загрузилась — клик «Повторить»");
    btn.scrollIntoView({ block: "center", inline: "nearest" });
    await S.sleep(S.GAP_MS);
    S.clickEl(btn);
    try {
      btn.click();
    } catch {
      /* ignore */
    }
    return { ok: true };
  }

  function hoverEl(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      clientX: r.left + Math.max(1, r.width / 2),
      clientY: r.top + Math.max(1, r.height / 2),
    };
    el.dispatchEvent(new MouseEvent("mouseover", opts));
    el.dispatchEvent(new MouseEvent("mouseenter", opts));
    el.dispatchEvent(new MouseEvent("mousemove", opts));
  }

  function copyButtonNearImage(img) {
    let node = img?.closest?.("generated-image") || img;
    for (let i = 0; i < 8 && node; i++) {
      const host =
        node.querySelector?.(
          '[data-test-id="copy-generated-image-button"]',
        ) ||
        node.querySelector?.(
          'gem-icon-button[arialabel="Копировать изображение"]',
        ) ||
        node.querySelector?.('gem-icon-button[arialabel="Copy image"]');
      if (host) return host.querySelector("button") || host;
      node = node.parentElement;
    }
    return null;
  }

  function lastCopyImageButton() {
    const hosts = [
      ...document.querySelectorAll(
        '[data-test-id="copy-generated-image-button"]',
      ),
      ...document.querySelectorAll(
        'gem-icon-button[arialabel="Копировать изображение"]',
      ),
      ...document.querySelectorAll('gem-icon-button[arialabel="Copy image"]'),
    ];
    const host = hosts[hosts.length - 1];
    if (!host) return copyImageButton();
    return host.querySelector("button") || host;
  }

  async function captureClipboardAfterCopyClick(btn) {
    const before = await S.readClipboardFingerprint(1024);
    S.appendLog("Клик «Копировать изображение»");
    await S.sleep(S.GAP_MS);
    S.clickEl(btn);
    try {
      btn.click();
    } catch {
      /* ignore */
    }

    const start = Date.now();
    let lastReason = "пусто";
    while (Date.now() - start < 25000) {
      const info = await S.readClipboardImageBlob(1500);
      if (!info.ok || !info.blob) {
        lastReason = info.reason || "нет image";
        await S.sleep(400);
        continue;
      }
      const fpRaw = await S.fingerprintBlob(info.blob);
      if (before.ok && before.fingerprint && fpRaw === before.fingerprint) {
        lastReason = "буфер ещё старый";
        await S.sleep(400);
        continue;
      }
      const jpeg = await S.transcodeToJpeg(info.blob, info.type || "image/png");
      if (jpeg.width < 64 || jpeg.height < 64) {
        lastReason = `слишком маленький ${jpeg.width}×${jpeg.height}`;
        await S.sleep(400);
        continue;
      }
      const fingerprint = await S.fingerprintBlob(jpeg.blob);
      S.appendLog(
        `Clipboard→JPEG ${jpeg.width}×${jpeg.height}, ${Math.round(jpeg.size / 1024)} KB fp=${fingerprint}`,
      );
      return {
        ok: true,
        imageBase64: jpeg.imageBase64,
        mime: "image/jpeg",
        fingerprint,
        size: jpeg.size,
        width: jpeg.width,
        height: jpeg.height,
        via: "copy-image",
      };
    }
    throw new Error(
      `Таймаут: «Копировать изображение» не дало свежий буфер (${lastReason})`,
    );
  }

  async function clickCopyNewImage(prevSrcs) {
    const img = findNewGeneratedImage(prevSrcs);
    if (!img) throw new Error("Нет новой сгенерированной картинки");
    img.scrollIntoView({ block: "center", inline: "nearest" });
    let btn = null;
    for (let i = 0; i < 5 && !btn; i++) {
      hoverEl(img);
      hoverEl(img.closest("generated-image") || img);
      await S.sleep(S.GAP_PHASE_MS);
      btn = copyButtonNearImage(img);
    }
    if (!btn) btn = lastCopyImageButton();
    if (!btn) throw new Error("Нет кнопки «Копировать изображение» у новой картинки");
    return captureClipboardAfterCopyClick(btn);
  }

  async function pixelFingerprintBase64(imageBase64, mime) {
    if (!imageBase64) return null;
    try {
      const blob = S.base64ToBlob(imageBase64, mime || "image/jpeg");
      return await S.fingerprintPixels(blob);
    } catch {
      return null;
    }
  }

  /**
   * Берёт байты именно новой generated-image (src не из снимка до отправки).
   * Сначала скачивает этот src, клик «Копировать» — только если скачать нельзя.
   */
  async function captureNewGeneratedImage(prevSrcs, sourceBase64, sourceMime) {
    const img = findNewGeneratedImage(prevSrcs);
    if (!img) throw new Error("Нет новой сгенерированной картинки");
    const src = imageSrc(img);
    if ((prevSrcs || []).includes(src)) {
      throw new Error("Это прежняя картинка, не новая");
    }
    const sourcePixels = await pixelFingerprintBase64(sourceBase64, sourceMime);
    S.appendLog(
      `Новая картинка ${img.naturalWidth}×${img.naturalHeight}, скачиваю её src`,
    );

    let imageBase64 = "";
    let width = 0;
    let height = 0;
    try {
      const fetched = await fetchUrlAsBuffer(src);
      imageBase64 = fetched.imageBase64;
      width = fetched.width;
      height = fetched.height;
    } catch (err) {
      S.rethrowIfStepRetry(err);
      S.appendLog(
        `Скачать src не вышло (${err?.message || err}), клик «Копировать изображение»`,
        true,
      );
      const copied = await clickCopyNewImage(prevSrcs);
      imageBase64 = copied.imageBase64;
      width = copied.width;
      height = copied.height;
    }

    const still = findNewGeneratedImage(prevSrcs);
    if (!still || imageSrc(still) !== src) {
      throw new Error("После скачивания на экране уже не эта новая картинка");
    }
    const blob = S.base64ToBlob(imageBase64, "image/jpeg");
    const pixels = await S.fingerprintPixels(blob);
    if (!pixels) throw new Error("Не удалось снять отпечаток новой картинки");
    if (sourcePixels && pixels === sourcePixels) {
      throw new Error("Скачалась исходная картинка, не новая");
    }
    const fingerprint = await S.fingerprintBlob(blob);
    S.appendLog(
      `Новая картинка подтверждена ${width}×${height} px=${pixels}`,
    );
    return {
      ok: true,
      imageBase64,
      mime: "image/jpeg",
      fingerprint,
      pixels,
      width,
      height,
      src,
    };
  }

  function downloadButtonNearImage(img) {
    let node = img?.closest?.("generated-image") || img;
    for (let i = 0; i < 8 && node; i++) {
      const host =
        node.querySelector?.(
          '[data-test-id="download-generated-image-button"]',
        ) ||
        node.querySelector?.(
          'gem-icon-button[arialabel="Скачать изображение в полном размере"]',
        ) ||
        node.querySelector?.(
          'gem-icon-button[arialabel="Download full size image"]',
        );
      if (host) return host.querySelector("button") || host;
      node = node.parentElement;
    }
    return downloadFullButton();
  }

  function readNewImageSrc(prevSrcs) {
    const img = findNewGeneratedImage(prevSrcs);
    if (!img) throw new Error("Нет новой сгенерированной картинки");
    const src = imageSrc(img);
    if (!src || (prevSrcs || []).includes(src)) {
      throw new Error("Это прежняя картинка, не новая");
    }
    return {
      ok: true,
      src,
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  }

  async function finishCapturedJpeg(
    imageBase64,
    mime,
    prevSrcs,
    src,
    sourceBase64,
    sourceMime,
    strictSrc,
  ) {
    if (strictSrc && src) {
      const still = findNewGeneratedImage(prevSrcs);
      if (!still || imageSrc(still) !== src) {
        throw new Error("После скачивания на экране уже не эта новая картинка");
      }
    }
    const jpeg = await S.transcodeToJpeg(imageBase64, mime || "image/jpeg");
    const pixels = await S.fingerprintPixels(jpeg.blob);
    const sourcePixels = await pixelFingerprintBase64(sourceBase64, sourceMime);
    if (!pixels) throw new Error("Не удалось снять отпечаток новой картинки");
    if (sourcePixels && pixels === sourcePixels) {
      throw new Error("Скачалась исходная картинка, не новая");
    }
    const fingerprint = await S.fingerprintBlob(jpeg.blob);
    S.appendLog(
      `Новая картинка подтверждена ${jpeg.width}×${jpeg.height} px=${pixels}`,
    );
    return {
      ok: true,
      imageBase64: jpeg.imageBase64,
      mime: "image/jpeg",
      fingerprint,
      pixels,
      width: jpeg.width,
      height: jpeg.height,
      src: src || "",
    };
  }

  async function downloadNewGeneratedImage(prevSrcs, sourceBase64, sourceMime) {
    const img = findNewGeneratedImage(prevSrcs);
    if (!img) throw new Error("Нет новой сгенерированной картинки");
    const src = imageSrc(img);
    img.scrollIntoView({ block: "center", inline: "nearest" });
    let btn = null;
    for (let i = 0; i < 5 && !btn; i++) {
      hoverEl(img);
      hoverEl(img.closest("generated-image") || img);
      await S.sleep(S.GAP_PHASE_MS);
      btn = downloadButtonNearImage(img);
    }
    if (!btn) throw new Error("Нет кнопки «Скачать» у новой картинки");
    S.appendLog("Клик «Скачать» у новой картинки");
    const capture = armImageBlobCapture(S.WAIT_DOWNLOAD_MS);
    await S.sleep(S.GAP_MS);
    S.clickEl(btn);
    try {
      btn.click();
    } catch {
      /* ignore */
    }
    try {
      const payload = await capture.promise;
      return finishCapturedJpeg(
        payload.imageBase64,
        payload.mime,
        prevSrcs,
        src,
        sourceBase64,
        sourceMime,
        false,
      );
    } catch (err) {
      capture.disarm();
      throw err;
    }
  }

  function dispatchImagePaste(target, file) {
    if (!target) return false;
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      target.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async function waitNewAttachment(before, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const added = composerAttachmentCount() - before;
      if (added > 0) return added;
      await S.sleep(100);
    }
    return composerAttachmentCount() - before;
  }

  async function appendComposerText(editor, text) {
    await focusEditorViaClick(editor);
    placeCaretAtEnd(editor);
    try {
      document.execCommand("insertText", false, text);
    } catch {
      /* ignore */
    }
    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
    return textLooksInserted(editor, text.trim());
  }

  async function waitFreshComposer() {
    let last = null;
    let stable = 0;
    const start = Date.now();
    while (Date.now() - start < 12000) {
      const path = location.pathname.replace(/\/+$/, "");
      const editor = composerEditor();
      const fresh =
        (path === "/app" || path === "") &&
        userQueryCount() === 0 &&
        editor &&
        !String(editor.textContent || "").trim() &&
        composerAttachmentCount() === 0;
      if (fresh && editor === last) {
        stable += 1;
        if (stable >= 3) return editor;
      } else {
        stable = 0;
        last = fresh ? editor : null;
      }
      await S.sleep(200);
    }
    return composerEditor();
  }

  /**
   * Продолжение чата: PNG в буфер → вставка в нижний composer → текст-префикс.
   * submit: новый чат доработки — вставить картинку и сразу отправить.
   */
  async function pasteIconContinue({ imageBase64, mime, text, submit = false }) {
    const promptText = String(text || S.ALTER_CONTINUE_TEXT);
    if (submit) await waitFreshComposer();
    const editor = await waitComposerEditor();
    if (!editor) throw new Error("Нет composer Gemini (новое сообщение)");
    const blob = S.base64ToBlob(imageBase64, mime || "image/png");
    if (!blob?.size) throw new Error("Пустая иконка 512");
    const png = await S.writeClipboardPng(blob);
    S.appendLog(
      `512 в буфер (${Math.round(png.size / 1024)} KB), вставка в продолжение чата…`,
    );

    editor.scrollIntoView({ block: "center", inline: "nearest" });
    await focusEditorViaClick(editor);
    try {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
    } catch {
      /* ignore */
    }

    const before = composerAttachmentCount();
    const file = new File([png], "icon-512.png", { type: "image/png" });
    const steps = [
      async () => {
        const input = await ensureImageFileInput();
        if (!input) return;
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      async () => {
        await focusEditorViaClick(editor);
        dispatchImagePaste(editor, file);
      },
      async () => {
        await focusEditorViaClick(editor);
        try {
          document.execCommand("paste");
        } catch {
          /* ignore */
        }
      },
    ];
    let attached = false;
    for (let i = 0; i < steps.length && !attached; i++) {
      await steps[i]();
      const added = await waitNewAttachment(before, S.GAP_AFTER_INSERT_MS);
      if (added > 0) {
        attached = true;
        S.appendLog(
          added === 1
            ? "Одна картинка в composer"
            : `Картинок в composer: ${added}`,
        );
      }
    }
    if (!attached) {
      throw new Error(
        "Не удалось вставить 512 в продолжение чата (composer не показал картинку)",
      );
    }

    const typed = await appendComposerText(editor, promptText);
    if (!typed || composerEditor() !== editor) {
      throw new Error(
        submit
          ? "Промпт доработки не появился в composer"
          : "Текст «Для этого изображения» не появился в composer",
      );
    }
    const srcs = snapshotGeneratedSrcs();
    if (submit) {
      if (composerAttachmentCount() < 1) {
        throw new Error("Картинка пропала из нового чата до отправки");
      }
      await clickComposerSend(promptText);
      S.appendLog("Картинка и промпт отправлены, жду новую картинку");
      return { ok: true, srcs };
    }
    S.appendLog(
      "Префикс вписан. Допишите запрос и отправьте — жду новую картинку",
    );
    return { ok: true, srcs };
  }

  async function clickNewChat() {
    const path = location.pathname.replace(/\/+$/, "");
    const empty =
      (path === "/app" || path === "") && !document.querySelector("user-query");
    if (empty && composerEditor()) {
      const settled = await waitFreshComposer();
      if (settled) {
        S.appendLog("Уже открыт новый чат");
        return { ok: true, already: true };
      }
    }
    const link = [...document.querySelectorAll("a")].find((el) => {
      const aria = (el.getAttribute("aria-label") || "").trim();
      const href = el.getAttribute("href") || "";
      return (
        /^Новый чат$|^New chat$/i.test(aria) &&
        (href === "/app" || href.endsWith("/app"))
      );
    });
    if (!link) throw new Error("Нет кнопки «Новый чат»");
    S.clickEl(link);
    try {
      link.click();
    } catch {
      /* ignore */
    }
    const start = Date.now();
    while (Date.now() - start < 12000) {
      const now = location.pathname.replace(/\/+$/, "");
      if (
        (now === "/app" || now === "") &&
        !document.querySelector("user-query") &&
        composerEditor()
      ) {
        const settled = await waitFreshComposer();
        if (!settled) throw new Error("Новый чат не открылся");
        S.appendLog("Нажат «Новый чат»");
        return { ok: true };
      }
      await S.sleep(200);
    }
    throw new Error("Новый чат не открылся");
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      if (msg?.type === "PING") return { ok: true };
      if (msg?.type === "ARM_STEP") {
        S.armStep(msg.epoch);
        return { ok: true };
      }
      if (msg?.type === "ABORT_STEP") {
        S.abortStep(msg.epoch);
        return { ok: true };
      }
      if (msg?.type === "CLICK_NEW_CHAT") return clickNewChat();
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
      if (msg?.type === "EDIT_AND_GENERATE") {
        return editAndGenerate(msg.prompt, {
          waitMs: msg.waitMs,
          imageTimeout: msg.imageTimeout,
        });
      }
      if (msg?.type === "CLICK_DOWNLOAD_FULL_CAPTURE") {
        return clickDownloadFullAndCapture();
      }
      if (msg?.type === "CLICK_COPY_IMAGE_CAPTURE") {
        return clickCopyImageAndCapture();
      }
      if (msg?.type === "PASTE_ICON_CONTINUE") {
        return pasteIconContinue({
          imageBase64: msg.imageBase64,
          mime: msg.mime,
          text: msg.text,
        });
      }
      if (msg?.type === "PASTE_ICON_AND_SEND") {
        return pasteIconContinue({
          imageBase64: msg.imageBase64,
          mime: msg.mime,
          text: msg.text,
          submit: true,
        });
      }
      if (msg?.type === "SNAPSHOT_GENERATED_IMAGES") {
        return { ok: true, srcs: snapshotGeneratedSrcs() };
      }
      if (msg?.type === "POLL_NEW_IMAGE") {
        const img = findNewGeneratedImage(msg.prevSrcs);
        const broken = img ? null : findBrokenGeneratedImage(msg.prevSrcs);
        return {
          ok: true,
          generating: isGenerating(),
          ready: Boolean(img) && !isGenerating(),
          broken: Boolean(broken) && !isGenerating(),
          brokenSrc: broken ? imageSrc(broken) : "",
        };
      }
      if (msg?.type === "RETRY_IMAGE_GENERATION") {
        return clickRetryGeneration();
      }
      if (msg?.type === "CLICK_COPY_NEW_IMAGE") {
        return clickCopyNewImage(msg.prevSrcs);
      }
      if (msg?.type === "CAPTURE_NEW_IMAGE") {
        return captureNewGeneratedImage(
          msg.prevSrcs,
          msg.sourceBase64,
          msg.sourceMime,
        );
      }
      if (msg?.type === "NEW_IMAGE_SRC") {
        return readNewImageSrc(msg.prevSrcs);
      }
      if (msg?.type === "CONFIRM_FETCHED_IMAGE") {
        return finishCapturedJpeg(
          msg.imageBase64,
          msg.mime,
          msg.prevSrcs,
          msg.src,
          msg.sourceBase64,
          msg.sourceMime,
          true,
        );
      }
      if (msg?.type === "DOWNLOAD_NEW_IMAGE") {
        return downloadNewGeneratedImage(
          msg.prevSrcs,
          msg.sourceBase64,
          msg.sourceMime,
        );
      }
      if (msg?.type === "FETCH_BLOB_URL") {
        return fetchUrlAsBuffer(msg.url);
      }
      return { ok: false, error: "unknown message" };
    })()
      .then(sendResponse)
      .catch((err) =>
        sendResponse({ ok: false, error: err?.message || String(err) }),
      );
    return true;
  });
})();
