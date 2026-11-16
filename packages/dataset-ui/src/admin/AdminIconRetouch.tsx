import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  Pagination,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { ADMIN_GAME_ICON_LIST_PREVIEW_SIZES } from "@l-fight/shared-ui/constants/admin-game-icons-list-previews";
import { buildGameIconUrl } from "@l-fight/shared-ui/config/game-icons-cdn";
import {
  applyIconRetouchPromptColor,
  ICON_RETOUCH_BG_HEX,
  ICON_RETOUCH_PROMPT_TEMPLATE,
  selectNextAfterRemoval,
  type GameIconImage,
  type IconRetouchBgCategory,
} from "@l-fight/dataset";
import { datasetAdminApi as adminApi } from "./datasetAdminApi";
import SquareCropDialog from "./SquareCropDialog";

const PAGE_SIZE = 50;
const FILTERS_STORAGE_KEY = "admin-icon-retouch-filters-v1";

export const DEFAULT_ICON_RETOUCH_PROMPT = ICON_RETOUCH_PROMPT_TEMPLATE;

const RETOUCH_BG_LABELS: Record<IconRetouchBgCategory, string> = {
  weapon: "Оружие",
  armor: "Броня",
  shield: "Щит",
  accessory: "Аксессуары",
  consumable: "Расходники",
  material: "Материалы",
  quest: "Квест и ключи",
  junk: "Хлам",
};

const RETOUCH_BG_CATEGORIES = Object.keys(
  ICON_RETOUCH_BG_HEX,
) as IconRetouchBgCategory[];

const BG_HEX_STORAGE_KEY = "admin-icon-retouch-bg-hex-v1";
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

export function readRetouchBgHex(
  raw: string | null,
): Record<IconRetouchBgCategory, string> {
  const next = { ...ICON_RETOUCH_BG_HEX };
  if (!raw) return next;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const category of RETOUCH_BG_CATEGORIES) {
      const value = parsed[category];
      if (typeof value === "string" && HEX_COLOR_RE.test(value)) {
        next[category] = value.toUpperCase();
      }
    }
  } catch {
    return { ...ICON_RETOUCH_BG_HEX };
  }
  return next;
}

type ListFilters = {
  showOnlyNotPendingSync: boolean;
  showOnlyNeedLocalUpdate: boolean;
};

function readFilters(): ListFilters {
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) {
      return { showOnlyNotPendingSync: false, showOnlyNeedLocalUpdate: false };
    }
    const parsed = JSON.parse(raw) as Partial<ListFilters>;
    return {
      showOnlyNotPendingSync: Boolean(parsed.showOnlyNotPendingSync),
      showOnlyNeedLocalUpdate: Boolean(parsed.showOnlyNeedLocalUpdate),
    };
  } catch {
    return { showOnlyNotPendingSync: false, showOnlyNeedLocalUpdate: false };
  }
}

function copyPromptText(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    area.remove();
  }
  return ok;
}

function readApiErrorMessage(error: unknown, fallback: string): string {
  const status = (error as { response?: { status?: number } })?.response
    ?.status;
  const message = (
    error as { response?: { data?: { message?: unknown } } }
  )?.response?.data?.message;
  if (typeof message === "string" && message.trim()) return message;
  if (Array.isArray(message)) {
    const text = message.filter((item) => typeof item === "string").join("; ");
    if (text) return text;
  }
  if (status === 404) return fallback;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function isNotFound(error: unknown): boolean {
  return (
    (error as { response?: { status?: number } })?.response?.status === 404
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(blob);
  });
}

function PreviewImage({ src, size, alt }: { src: string; size: number; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  if (!src || failed) {
    return (
      <Box
        sx={{
          width: size,
          height: size,
          border: "1px solid rgba(255,255,255,0.2)",
          color: "rgba(255,255,255,0.6)",
          display: "grid",
          placeItems: "center",
          fontSize: 11,
        }}
      >
        нет
      </Box>
    );
  }
  return (
    <Box
      component="img"
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      sx={{
        width: size,
        height: size,
        objectFit: "cover",
        border: "1px solid rgba(255,255,255,0.2)",
      }}
    />
  );
}

export default function AdminIconRetouch() {
  const [icons, setIcons] = useState<string[]>([]);
  const [selectedIcon, setSelectedIcon] = useState("");
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [prompt, setPrompt] = useState(DEFAULT_ICON_RETOUCH_PROMPT);
  const [filters, setFilters] = useState(readFilters);
  const [updatedLocallyIcons, setUpdatedLocallyIcons] = useState<Set<string>>(
    () => new Set(),
  );
  const [updatedInS3Icons, setUpdatedInS3Icons] = useState<Set<string>>(
    () => new Set(),
  );
  const [rawIcons, setRawIcons] = useState<Set<string>>(() => new Set());
  const [localV, setLocalV] = useState<Record<string, number>>({});
  const [s3Bust, setS3Bust] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const [clearingPending, setClearingPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pasteApplying, setPasteApplying] = useState(false);
  const [transformingOp, setTransformingOp] = useState<
    "flipHorizontal" | "rotate180" | null
  >(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bgHex, setBgHex] = useState(() =>
    readRetouchBgHex(localStorage.getItem(BG_HEX_STORAGE_KEY)),
  );
  const [hexDraft, setHexDraft] = useState<
    Partial<Record<IconRetouchBgCategory, string>>
  >({});
  const [pasteImageSrc, setPasteImageSrc] = useState("");
  const pasteObjectUrlRef = useRef<string | null>(null);

  const selectedIconRef = useRef(selectedIcon);
  const visibleIconsRef = useRef<string[]>([]);
  const prevVisibleIconsRef = useRef<string[]>([]);
  const savingRef = useRef(false);
  selectedIconRef.current = selectedIcon;

  useEffect(() => {
    try {
      const keys = Object.keys(localStorage).filter((key) =>
        key.startsWith("admin-icon-retouch-prompt"),
      );
      for (const key of keys) localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      adminApi.getDatasetRaw<GameIconImage[]>("item-icons"),
      adminApi
        .getGameIconRetouchUpdatedLocally()
        .catch(() => ({ data: { icons: [] as string[] } })),
      adminApi
        .getGameIconRetouchUpdatedInS3()
        .catch(() => ({ data: { icons: [] as string[] } })),
      adminApi
        .getGameIconRetouchRaw()
        .catch(() => ({ data: { icons: [] as string[] } })),
    ]).then(
      ([
        iconsResponse,
        updatedLocallyResponse,
        updatedInS3Response,
        rawResponse,
      ]) => {
      if (cancelled) return;
      const rows = Array.isArray(iconsResponse.data) ? iconsResponse.data : [];
      const nextIcons = rows
        .map((row) => String(row?.id ?? "").trim())
        .filter((id) => id.startsWith("g"))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      setIcons(nextIcons);
      setSelectedIcon((prev) => prev || nextIcons[0] || "");
      setUpdatedLocallyIcons(
        new Set(updatedLocallyResponse.data.icons ?? []),
      );
      setUpdatedInS3Icons(new Set(updatedInS3Response.data.icons ?? []));
      setRawIcons(new Set(rawResponse.data.icons ?? []));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleIcons = useMemo(() => {
    let list = icons;
    if (filters.showOnlyNeedLocalUpdate) {
      list = list.filter((icon) => !updatedInS3Icons.has(icon));
    }
    if (filters.showOnlyNotPendingSync) {
      list = list.filter((icon) => !updatedLocallyIcons.has(icon));
    }
    return list;
  }, [filters, icons, updatedInS3Icons, updatedLocallyIcons]);
  visibleIconsRef.current = visibleIcons;

  const totalPages = Math.max(1, Math.ceil(visibleIcons.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedIcons = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return visibleIcons.slice(start, start + PAGE_SIZE);
  }, [safePage, visibleIcons]);

  useEffect(() => {
    const prevVisible = prevVisibleIconsRef.current;
    prevVisibleIconsRef.current = visibleIcons;

    if (!visibleIcons.length) {
      setSelectedIcon("");
      return;
    }
    if (visibleIcons.includes(selectedIcon)) return;

    const next = selectNextAfterRemoval(prevVisible, selectedIcon);
    if (!next) {
      setSelectedIcon(visibleIcons[0] ?? "");
      return;
    }
    const nextPage = Math.floor(visibleIcons.indexOf(next) / PAGE_SIZE) + 1;
    setPage(nextPage);
    setPageInput(String(nextPage));
    setSelectedIcon(next);
  }, [selectedIcon, visibleIcons]);

  const bumpLocal = useCallback((icon: string) => {
    setLocalV((prev) => ({ ...prev, [icon]: Date.now() }));
  }, []);

  const markUpdatedLocally = useCallback((icon: string) => {
    setUpdatedLocallyIcons((prev) => {
      if (prev.has(icon)) return prev;
      const next = new Set(prev);
      next.add(icon);
      return next;
    });
  }, []);

  const rememberRaw = useCallback((icon: string) => {
    setRawIcons((prev) => {
      if (prev.has(icon)) return prev;
      const next = new Set(prev);
      next.add(icon);
      return next;
    });
  }, []);

  const closePasteDialog = useCallback(() => {
    setPasteDialogOpen(false);
    if (pasteObjectUrlRef.current) {
      URL.revokeObjectURL(pasteObjectUrlRef.current);
      pasteObjectUrlRef.current = null;
    }
    setPasteImageSrc("");
  }, []);

  const openPasteDialogWithBlob = useCallback((blob: Blob) => {
    if (pasteObjectUrlRef.current) {
      URL.revokeObjectURL(pasteObjectUrlRef.current);
    }
    const url = URL.createObjectURL(blob);
    pasteObjectUrlRef.current = url;
    setPasteImageSrc(url);
    setPasteDialogOpen(true);
    setError("");
  }, []);

  useEffect(() => {
    return () => {
      if (pasteObjectUrlRef.current) {
        URL.revokeObjectURL(pasteObjectUrlRef.current);
      }
    };
  }, []);

  const advanceAfterSave = useCallback((icon: string) => {
    const list = visibleIconsRef.current;
    const idx = list.indexOf(icon);
    if (idx < 0 || idx + 1 >= list.length) return;
    const next = list[idx + 1];
    const nextPage = Math.floor((idx + 1) / PAGE_SIZE) + 1;
    setPage(nextPage);
    setPageInput(String(nextPage));
    setSelectedIcon(next);
  }, []);

  const handleSaveRawAndApplyBlob = useCallback(
    async (
      blob: Blob,
      advance: boolean,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const icon = selectedIconRef.current;
      if (!icon) {
        const message = "Сначала выберите иконку";
        setError(message);
        return { ok: false, error: message };
      }
      if (savingRef.current) {
        const message = "Сохранение уже идёт";
        return { ok: false, error: message };
      }
      savingRef.current = true;
      setSaving(true);
      setError("");
      try {
        const imageBase64 = await blobToBase64(blob);
        await adminApi.saveGameIconRetouchRaw({ icon, imageBase64 });
        rememberRaw(icon);
        await adminApi.applyGameIconRetouchRaw(icon);
        markUpdatedLocally(icon);
        bumpLocal(icon);
        if (advance) advanceAfterSave(icon);
        return { ok: true };
      } catch (e) {
        const message = readApiErrorMessage(
          e,
          "Не удалось сохранить буфер доработки и применить в 512",
        );
        setError(message);
        return { ok: false, error: message };
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [advanceAfterSave, bumpLocal, markUpdatedLocally, rememberRaw],
  );

  const handleSaveRawFromFile = useCallback(
    (file: File | undefined) => {
      const icon = selectedIconRef.current;
      if (!icon) {
        setError("Сначала выберите иконку");
        return;
      }
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError("Выберите файл изображения");
        return;
      }
      void (async () => {
        setSaving(true);
        setError("");
        try {
          const imageBase64 = await blobToBase64(file);
          await adminApi.saveGameIconRetouchRaw({ icon, imageBase64 });
          rememberRaw(icon);
          bumpLocal(icon);
        } catch (e) {
          setError(readApiErrorMessage(e, "Не удалось сохранить сырой буфер"));
        } finally {
          setSaving(false);
        }
      })();
    },
    [bumpLocal, rememberRaw],
  );

  const handleApplyRawAsIs = useCallback(async () => {
    const icon = selectedIconRef.current;
    if (!icon) return;
    setPasteApplying(true);
    setError("");
    try {
      await adminApi.applyGameIconRetouchRaw(icon);
      markUpdatedLocally(icon);
      bumpLocal(icon);
    } catch (e) {
      setError(readApiErrorMessage(e, "Не удалось применить сырой буфер"));
    } finally {
      setPasteApplying(false);
    }
  }, [bumpLocal, markUpdatedLocally]);

  const handleCropFromRaw = useCallback(async () => {
    const icon = selectedIconRef.current;
    if (!icon) {
      setError("Сначала выберите иконку");
      return;
    }
    setError("");
    try {
      const response = await fetch(
        `/api/icons/raw-retouch/${encodeURIComponent(icon)}?v=${Date.now()}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setError("В сыром буфере нет картинки");
        return;
      }
      openPasteDialogWithBlob(await response.blob());
    } catch (e) {
      setError(readApiErrorMessage(e, "Не удалось открыть сырой буфер"));
    }
  }, [openPasteDialogWithBlob]);

  const handlePasteCropApply = useCallback(
    async (imageBase64: string) => {
      const icon = selectedIconRef.current;
      if (!icon) return;
      setPasteApplying(true);
      setError("");
      try {
        await adminApi.fromRetouchClipboardGameIcon({ icon, imageBase64 });
        markUpdatedLocally(icon);
        bumpLocal(icon);
        closePasteDialog();
      } catch (e) {
        setError(readApiErrorMessage(e, "Не удалось применить кроп"));
      } finally {
        setPasteApplying(false);
      }
    },
    [bumpLocal, closePasteDialog, markUpdatedLocally],
  );

  useEffect(() => {
    const onSave = (event: Event) => {
      const detail = (event as CustomEvent<{ blob?: Blob; advance?: boolean }>)
        .detail;
      void (async () => {
        const blob = detail?.blob;
        if (!blob) {
          window.dispatchEvent(
            new CustomEvent("l-fight-admin-save-raw-result", {
              detail: { ok: false, error: "Пустой файл" },
            }),
          );
          return;
        }
        const result = await handleSaveRawAndApplyBlob(
          blob,
          detail?.advance !== false,
        );
        window.dispatchEvent(
          new CustomEvent("l-fight-admin-save-raw-result", { detail: result }),
        );
      })();
    };
    const onReadS3 = () => {
      void (async () => {
        const icon = selectedIconRef.current;
        if (!icon) {
          window.dispatchEvent(
            new CustomEvent("l-fight-admin-read-s3-result", {
              detail: { ok: false, missing: true, error: "Нет выбранной иконки" },
            }),
          );
          return;
        }
        try {
          const { data } = await adminApi.getGameIconS3Source(icon);
          window.dispatchEvent(
            new CustomEvent("l-fight-admin-read-s3-result", {
              detail: {
                ok: true,
                icon: data.icon,
                imageBase64: data.imageBase64,
                mime: data.mime,
              },
            }),
          );
        } catch (e) {
          window.dispatchEvent(
            new CustomEvent("l-fight-admin-read-s3-result", {
              detail: {
                ok: false,
                missing: isNotFound(e),
                icon,
                error: readApiErrorMessage(e, `Нет S3 для ${icon}`),
              },
            }),
          );
        }
      })();
    };
    const onAdvance = () => {
      const icon = selectedIconRef.current;
      if (icon) advanceAfterSave(icon);
    };
    const onClear = () => setError("");
    const onRetouchError = (event: Event) => {
      const message = (event as CustomEvent<{ error?: string }>).detail?.error;
      if (message) setError(message);
    };
    window.addEventListener("l-fight-admin-save-raw-image", onSave);
    window.addEventListener("l-fight-admin-read-s3", onReadS3);
    window.addEventListener("l-fight-admin-advance-retouch", onAdvance);
    window.addEventListener("l-fight-admin-clear-error", onClear);
    window.addEventListener("l-fight-admin-retouch-error", onRetouchError);
    return () => {
      window.removeEventListener("l-fight-admin-save-raw-image", onSave);
      window.removeEventListener("l-fight-admin-read-s3", onReadS3);
      window.removeEventListener("l-fight-admin-advance-retouch", onAdvance);
      window.removeEventListener("l-fight-admin-clear-error", onClear);
      window.removeEventListener("l-fight-admin-retouch-error", onRetouchError);
    };
  }, [handleSaveRawAndApplyBlob]);

  const vOf = (icon: string) => localV[icon] ?? 0;
  const rawUrl = selectedIcon
    ? `/api/icons/raw-retouch/${encodeURIComponent(selectedIcon)}?v=${vOf(selectedIcon)}`
    : "";
  const localUrl = selectedIcon
    ? `/api/icons/generated-retouch/${encodeURIComponent(selectedIcon)}?v=${vOf(selectedIcon)}`
    : "";
  const s3Url = selectedIcon
    ? buildGameIconUrl(selectedIcon, 512, s3Bust[selectedIcon])
    : "";
  const retouchBg = useMemo(
    () =>
      selectedIcon
        ? { category: "junk" as IconRetouchBgCategory, hex: ICON_RETOUCH_BG_HEX.junk }
        : null,
    [selectedIcon],
  );
  const retouchHex = retouchBg ? bgHex[retouchBg.category] : "";
  const promptBgHex = useMemo(() => {
    const match = /#([0-9A-Fa-f]{6})/.exec(prompt);
    return match ? `#${match[1]}` : "";
  }, [prompt]);
  useEffect(() => {
    if (!retouchHex) return;
    setPrompt((prev) => applyIconRetouchPromptColor(prev, retouchHex));
  }, [retouchHex]);

  const updateBgHex = (category: IconRetouchBgCategory, hex: string) => {
    const normalized = hex.toUpperCase();
    if (!HEX_COLOR_RE.test(normalized)) return;
    setBgHex((prev) => {
      const next = { ...prev, [category]: normalized };
      localStorage.setItem(BG_HEX_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setHexDraft((prev) => {
      if (prev[category] == null) return prev;
      const next = { ...prev };
      delete next[category];
      return next;
    });
  };

  const iconsNotPending = icons.filter(
    (icon) => !updatedLocallyIcons.has(icon),
  ).length;
  const iconsNeed = icons.filter((icon) => !updatedInS3Icons.has(icon)).length;

  const handleTransform = async (op: "flipHorizontal" | "rotate180") => {
    if (!selectedIcon || transformingOp) return;
    const icon = selectedIcon;
    setTransformingOp(op);
    setError("");
    try {
      const { data } = await adminApi.transformGameIconRetouch({ icon, op });
      if (data.transformedRaw) rememberRaw(icon);
      if (data.transformed512) markUpdatedLocally(icon);
      bumpLocal(icon);
    } catch (e) {
      setError(
        readApiErrorMessage(
          e,
          op === "flipHorizontal"
            ? "Не удалось зеркально отразить иконку"
            : "Не удалось повернуть иконку на 180°",
        ),
      );
    } finally {
      setTransformingOp(null);
    }
  };

  const handleApply = async () => {
    if (!selectedIcon) return;
    setApplying(true);
    setError("");
    const icon = selectedIcon;
    try {
      await adminApi.applyGameIconRetouch({ icon });
      setUpdatedLocallyIcons((prev) => {
        if (prev.has(icon)) return prev;
        const next = new Set(prev);
        next.add(icon);
        return next;
      });
      setUpdatedInS3Icons((prev) => {
        if (prev.has(icon)) return prev;
        const next = new Set(prev);
        next.add(icon);
        return next;
      });
      setS3Bust((prev) => ({ ...prev, [icon]: Date.now() }));
    } catch (e) {
      setError(readApiErrorMessage(e, "Не удалось синхронизировать в S3"));
    } finally {
      setApplying(false);
    }
  };

  const handleClearPending = async () => {
    if (!selectedIcon) return;
    setClearingPending(true);
    setError("");
    try {
      const { data } = await adminApi.clearGameIconRetouchPendingSync(
        selectedIcon,
      );
      setUpdatedLocallyIcons(new Set(data.updatedLocallyIcons ?? []));
      setUpdatedInS3Icons(new Set(data.updatedInS3Icons ?? []));
      bumpLocal(selectedIcon);
    } catch (e) {
      setError(readApiErrorMessage(e, "Не удалось снять локальную отметку"));
    } finally {
      setClearingPending(false);
    }
  };

  const commitPage = () => {
    const parsed = Number(pageInput.trim());
    if (!Number.isFinite(parsed)) {
      setPageInput(String(safePage));
      return;
    }
    const normalized = Math.max(1, Math.min(totalPages, Math.floor(parsed)));
    setPage(normalized);
    setPageInput(String(normalized));
  };

  return (
    <Stack direction="row" spacing={2} sx={{ px: 2, pb: 2 }}>
      <Paper
        sx={{ width: 360, maxHeight: "calc(100vh - 120px)", overflow: "auto" }}
      >
        <Box
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 1,
            py: 1,
            px: 1,
            backgroundColor: "rgba(20, 20, 25, 0.95)",
            borderBottom: "1px solid rgba(184, 134, 11, 0.2)",
          }}
        >
          <FormControlLabel
            sx={{ ml: 0 }}
            control={
              <Switch
                checked={filters.showOnlyNotPendingSync}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    showOnlyNotPendingSync: e.target.checked,
                  }))
                }
              />
            }
            label={`Ещё не обновлены локально${
              iconsNotPending ? ` (${iconsNotPending})` : ""
            }`}
          />
          <FormControlLabel
            sx={{ ml: 0 }}
            control={
              <Switch
                checked={filters.showOnlyNeedLocalUpdate}
                onChange={(e) =>
                  setFilters((prev) => ({
                    ...prev,
                    showOnlyNeedLocalUpdate: e.target.checked,
                  }))
                }
              />
            }
            label={`Ещё не обновлены в S3 (need-local-update)${
              iconsNeed ? ` (${iconsNeed})` : ""
            }`}
          />
          <Pagination
            count={totalPages}
            page={safePage}
            onChange={(_e, value) => {
              setPage(value);
              setPageInput(String(value));
            }}
            size="small"
            showFirstButton
            showLastButton
          />
          <TextField
            size="small"
            label="Страница"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={commitPage}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitPage();
              }
            }}
            sx={{ maxWidth: 120 }}
          />
          <Typography variant="caption" sx={{ opacity: 0.7 }}>
            Предметы: {visibleIcons.length}
          </Typography>
        </Box>
        <List dense>
          {pagedIcons.map((icon) => (
            <ListItemButton
              key={icon}
              selected={selectedIcon === icon}
              onClick={() => setSelectedIcon(icon)}
              sx={{ gap: 1, alignItems: "center" }}
            >
              <PreviewImage
                src={`/api/icons/raw-retouch/${encodeURIComponent(icon)}?v=${vOf(icon)}`}
                size={ADMIN_GAME_ICON_LIST_PREVIEW_SIZES.raw}
                alt={`${icon} retouch raw`}
              />
              <PreviewImage
                src={`/api/icons/generated-retouch/${encodeURIComponent(icon)}?v=${vOf(icon)}`}
                size={ADMIN_GAME_ICON_LIST_PREVIEW_SIZES.approved}
                alt={`${icon} retouch 512`}
              />
              <PreviewImage
                src={buildGameIconUrl(icon, 64, s3Bust[icon])}
                size={ADMIN_GAME_ICON_LIST_PREVIEW_SIZES.s3}
                alt={`${icon} s3`}
              />
              <ListItemText primary={icon} />
            </ListItemButton>
          ))}
        </List>
      </Paper>

      <Paper sx={{ flex: 1, p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h6">
            Редактор иконки: {selectedIcon || "-"}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.75 }}>
            Временная доработка. Буфер пишется в All-raw-retouch, 512 — в
            All-512-retouch. Старые All-raw и All-512-new не меняются. Источник
            картинки для Gemini — S3.
            {rawIcons.has(selectedIcon) ? " Сырой буфер доработки есть." : ""}
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Stack direction="row" spacing={2} alignItems="flex-start">
            <TextField
              label="Промпт"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              multiline
              minRows={5}
              fullWidth
            />
            <Box
              component="button"
              type="button"
              aria-label="Цвет фона промпта"
              title={promptBgHex || "В промпте нет цвета"}
              onClick={() => setPaletteOpen(true)}
              sx={{
                width: 100,
                height: 100,
                flexShrink: 0,
                p: 0,
                bgcolor: promptBgHex || "transparent",
                border: "1px solid",
                borderColor: "divider",
                cursor: "pointer",
              }}
            />
          </Stack>
          <Dialog open={paletteOpen} onClose={() => setPaletteOpen(false)}>
            <DialogTitle>Цвета фона по категориям</DialogTitle>
            <DialogContent>
              <Stack spacing={1.25} sx={{ pt: 0.5, minWidth: 360 }}>
                {RETOUCH_BG_CATEGORIES.map((category) => (
                  <Stack
                    key={category}
                    direction="row"
                    spacing={1.5}
                    alignItems="center"
                  >
                    <Box
                      component="input"
                      type="color"
                      aria-label={`Цвет: ${RETOUCH_BG_LABELS[category]}`}
                      value={bgHex[category].toLowerCase()}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        updateBgHex(category, event.target.value)
                      }
                      sx={{
                        width: 80,
                        height: 80,
                        flexShrink: 0,
                        p: 0,
                        border: "1px solid",
                        borderColor: "divider",
                        bgcolor: "transparent",
                        cursor: "pointer",
                        "&::-webkit-color-swatch-wrapper": { p: 0 },
                        "&::-webkit-color-swatch": { border: "none" },
                      }}
                    />
                    <Typography sx={{ width: 120 }}>
                      {RETOUCH_BG_LABELS[category]}
                    </Typography>
                    <TextField
                      size="small"
                      value={hexDraft[category] ?? bgHex[category]}
                      onChange={(event) => {
                        const value = event.target.value;
                        setHexDraft((prev) => ({
                          ...prev,
                          [category]: value,
                        }));
                        updateBgHex(category, value);
                      }}
                      slotProps={{
                        htmlInput: {
                          "aria-label": `Hex: ${RETOUCH_BG_LABELS[category]}`,
                          spellCheck: false,
                        },
                      }}
                      sx={{ width: 110 }}
                    />
                  </Stack>
                ))}
              </Stack>
            </DialogContent>
          </Dialog>
          <Button
            variant="outlined"
            disabled={!prompt.trim()}
            onClick={() => {
              const markCopied = () => {
                setPromptCopied(true);
                window.setTimeout(() => setPromptCopied(false), 1200);
              };
              if (copyPromptText(prompt)) {
                markCopied();
                return;
              }
              void navigator.clipboard.writeText(prompt).then(markCopied, () => {
                setPromptCopied(false);
                setCopyFailed(true);
                window.setTimeout(() => setCopyFailed(false), 1600);
              });
            }}
            sx={{ alignSelf: "flex-start" }}
          >
            {copyFailed
              ? "Не скопировалось"
              : promptCopied
                ? "Скопировано"
                : "Скопировать промпт"}
          </Button>
          <Stack direction="row" spacing={2} alignItems="flex-start">
            <Box>
              <Typography variant="caption">Сырой буфер</Typography>
              <PreviewImage src={rawUrl} size={128} alt="retouch raw" />
            </Box>
            <Box>
              <Typography variant="caption">Локальная 512</Typography>
              <PreviewImage src={localUrl} size={128} alt="retouch 512" />
            </Box>
            <Box>
              <Typography variant="caption">S3 512</Typography>
              <PreviewImage src={s3Url} size={128} alt="s3 512" />
            </Box>
          </Stack>
          <Box
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              p: 1.5,
            }}
          >
            <Typography variant="subtitle2">1. Сырой буфер</Typography>
            <Typography
              variant="caption"
              sx={{ display: "block", mb: 1, opacity: 0.75 }}
            >
              Файл с диска попадает в All-raw-retouch, без кропа и без Sync
            </Typography>
            <Button
              variant="outlined"
              component="label"
              disabled={!selectedIcon || saving || pasteApplying}
            >
              В сырой буфер с диска
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  handleSaveRawFromFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </Button>
          </Box>
          <Box
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              p: 1.5,
            }}
          >
            <Typography variant="subtitle2">2. Подготовка (512)</Typography>
            <Typography
              variant="caption"
              sx={{ display: "block", mb: 1, opacity: 0.75 }}
            >
              Из сырого буфера — в All-512-retouch. Кроп меняет квадрат, сырой
              файл остаётся
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                variant="outlined"
                onClick={() => void handleApplyRawAsIs()}
                disabled={
                  !selectedIcon ||
                  !rawIcons.has(selectedIcon) ||
                  saving ||
                  pasteApplying
                }
              >
                В 512 из сырого буфера
              </Button>
              <Button
                variant="outlined"
                onClick={() => void handleCropFromRaw()}
                disabled={
                  !selectedIcon ||
                  !rawIcons.has(selectedIcon) ||
                  saving ||
                  pasteApplying
                }
              >
                Кроп из сырого буфера
              </Button>
            </Stack>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
              sx={{ mt: 1 }}
            >
              <Button
                variant="outlined"
                onClick={() => void handleTransform("flipHorizontal")}
                disabled={!selectedIcon || saving || pasteApplying || transformingOp != null}
                title="Зеркально отразить сырой буфер и локальную 512 доработки по горизонтали"
              >
                {transformingOp === "flipHorizontal" ? (
                  <CircularProgress size={16} />
                ) : (
                  "Зеркало ←→"
                )}
              </Button>
              <Button
                variant="outlined"
                onClick={() => void handleTransform("rotate180")}
                disabled={!selectedIcon || saving || pasteApplying || transformingOp != null}
                title="Повернуть сырой буфер и локальную 512 доработки на 180°"
              >
                {transformingOp === "rotate180" ? (
                  <CircularProgress size={16} />
                ) : (
                  "Поворот 180°"
                )}
              </Button>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                Переворачивает сырой буфер и локальную 512 доработки (если есть)
              </Typography>
            </Stack>
          </Box>
          <Box
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              p: 1.5,
            }}
          >
            <Typography variant="subtitle2">3. Sync в S3</Typography>
            <Typography
              variant="caption"
              sx={{ display: "block", mb: 1, opacity: 0.75 }}
            >
              Залить локальную 512 доработки в S3
              {saving ? " · сохранение…" : ""}
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                color="warning"
                onClick={() => void handleApply()}
                disabled={applying || !selectedIcon}
              >
                {applying ? <CircularProgress size={18} /> : "Sync"}
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                onClick={() => void handleClearPending()}
                disabled={clearingPending || !selectedIcon}
                title="Удалить All-512-retouch PNG, убрать из pending доработки, добавить в need"
              >
                {clearingPending ? (
                  <CircularProgress size={16} />
                ) : (
                  "Снять локальную отметку"
                )}
              </Button>
            </Stack>
          </Box>
        </Stack>
      </Paper>
      <SquareCropDialog
        open={pasteDialogOpen}
        imageSrc={pasteImageSrc}
        applying={pasteApplying}
        error={error}
        onClose={closePasteDialog}
        onApply={(base64) => void handlePasteCropApply(base64)}
      />
    </Stack>
  );
}
