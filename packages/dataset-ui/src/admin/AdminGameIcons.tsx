import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Dialog,
  FormControlLabel,
  MenuItem,
  Switch,
  List,
  ListItemButton,
  ListItemText,
  Pagination,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useSearchParams } from "react-router-dom";
import {
  composeGameIconPrompt,
  gameIconImgKind,
  resolveGameIconLegacyRef,
  selectNextAfterRemoval,
  type GameIconImage,
} from "@l-fight/dataset";
import { ADMIN_GAME_ICON_LIST_PREVIEW_SIZES } from "@l-fight/shared-ui/constants/admin-game-icons-list-previews";
import { buildGameIconUrl } from "@l-fight/shared-ui/config/game-icons-cdn";
import { datasetAdminApi as adminApi } from "./datasetAdminApi";
import SquareCropDialog from "./SquareCropDialog";

export type GameIconKindTab = "items" | "skills" | "ui";

const PAGE_SIZE = 50;
const S3_CHECK_CONCURRENCY = 8;
const S3_CACHE_STORAGE_KEY = "admin-game-icons-s3-cache-v1";
const LIST_FILTERS_STORAGE_KEY = "admin-game-icons-list-filters-v3";

type ListFiltersState = {
  showOnlyMissingS3: boolean;
  showOnlyNotPendingSync: boolean;
  showOnlyNeedLocalUpdate: boolean;
  showOnlyRawBuffer: boolean;
  nameQuery: string;
};

const DEFAULT_LIST_FILTERS: ListFiltersState = {
  showOnlyMissingS3: false,
  showOnlyNotPendingSync: false,
  showOnlyNeedLocalUpdate: false,
  showOnlyRawBuffer: false,
  nameQuery: "",
};

function readListFiltersFromStorage(): ListFiltersState {
  try {
    const raw = localStorage.getItem(LIST_FILTERS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LIST_FILTERS };
    const parsed = JSON.parse(raw) as Partial<ListFiltersState>;
    if (!parsed || typeof parsed !== "object") {
      return { ...DEFAULT_LIST_FILTERS };
    }
    return {
      showOnlyMissingS3: Boolean(parsed.showOnlyMissingS3),
      showOnlyNotPendingSync: Boolean(parsed.showOnlyNotPendingSync),
      showOnlyNeedLocalUpdate: Boolean(parsed.showOnlyNeedLocalUpdate),
      showOnlyRawBuffer: Boolean(parsed.showOnlyRawBuffer),
      nameQuery: typeof parsed.nameQuery === "string" ? parsed.nameQuery : "",
    };
  } catch {
    return { ...DEFAULT_LIST_FILTERS };
  }
}

function toDataUrl(base64: string, mime: "image/png" | "image/jpeg"): string {
  return `data:${mime};base64,${base64}`;
}

function buildS3Url(icon: string, size: 64 | 512, cacheBust?: number): string {
  return buildGameIconUrl(icon, size, cacheBust);
}

function buildGeneratedLocalUrl(icon: string, v: number): string {
  return `/api/icons/generated/${icon}?v=${v}`;
}

function buildRawIconUrl(icon: string, v: number): string {
  return `/api/icons/raw/${encodeURIComponent(icon)}?v=${v}`;
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

/** `g0420 (accessary_…_i00)` при наличии rename-map. */
function formatEditorIconLabel(
  icon: string,
  iconRenameMap: Record<string, string>,
): string {
  const legacy = resolveGameIconLegacyRef(icon, iconRenameMap);
  return legacy !== icon ? `${icon} (${legacy})` : icon;
}

function PreviewImage({
  src,
  size,
  alt,
}: {
  src: string;
  size: number;
  alt: string;
}) {
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


async function readClipboardImageBlob(): Promise<Blob | null> {
  if (navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (imageType) {
          return item.getType(imageType);
        }
      }
    } catch {
      // fallback to paste event path
    }
  }
  return null;
}

function readApiErrorMessage(error: unknown, fallback: string): string {
  const message = (
    error as { response?: { data?: { message?: unknown } } }
  )?.response?.data?.message;
  if (typeof message === "string" && message.trim()) return message;
  if (Array.isArray(message)) {
    const text = message.filter((item) => typeof item === "string").join("; ");
    if (text) return text;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}


export default function AdminGameIcons({ kind }: { kind: GameIconKindTab }) {
  const [searchParams] = useSearchParams();
  const deepLinkQ = (searchParams.get("q") ?? "").trim();

  const [catalog, setCatalog] = useState<{
    icons: string[];
    descriptions: Record<string, string>;
    iconRenameMap: Record<string, string>;
  }>({ icons: [], descriptions: {}, iconRenameMap: {} });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      adminApi.getDatasetRaw<GameIconImage[]>(
        kind === "skills" ? "skill-icons" : "item-icons",
      ),
      adminApi
        .getDatasetRaw<Record<string, string>>("game-icons-rename-map")
        .catch(() => ({ data: {} as Record<string, string> })),
      adminApi.getGameIconsPendingSync().catch(() => ({ data: { icons: [] } })),
      adminApi
        .getGameIconsNeedLocalUpdate()
        .catch(() => ({ data: { icons: [] } })),
      adminApi.getGameIconsRaw().catch(() => ({ data: { icons: [] } })),
    ]).then(
      ([
        iconsResponse,
        renameResponse,
        pendingResponse,
        needUpdateResponse,
        rawResponse,
      ]) => {
        if (cancelled) return;
        const rows = Array.isArray(iconsResponse.data) ? iconsResponse.data : [];
        const descriptions: Record<string, string> = {};
        const icons: string[] = [];
        for (const row of rows) {
          const id = String(row?.id ?? "").trim();
          if (!id) continue;
          icons.push(id);
          descriptions[id] = String(row?.description ?? "").trim();
        }
        icons.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const iconRenameMap =
          renameResponse.data && typeof renameResponse.data === "object"
            ? renameResponse.data
            : {};
        setCatalog({ icons, descriptions, iconRenameMap });
        setPendingSyncIcons(new Set(pendingResponse.data.icons ?? []));
        setNeedLocalUpdateIcons(new Set(needUpdateResponse.data.icons ?? []));
        setRawIcons(new Set(rawResponse.data.icons ?? []));
      },
    ).catch(() => {
      if (!cancelled)
        setCatalog({ icons: [], descriptions: {}, iconRenameMap: {} });
    });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const { icons, descriptions, iconRenameMap } = catalog;

  const [selectedIcon, setSelectedIcon] = useState<string>(icons[0] ?? "");
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [prompt, setPrompt] = useState("");
  const [applying, setApplying] = useState(false);
  const [restoringFromS3, setRestoringFromS3] = useState(false);
  const [copying512, setCopying512] = useState(false);
  const [copied512, setCopied512] = useState(false);
  const [transformingLocalOp, setTransformingLocalOp] = useState<
    "flipHorizontal" | "rotate180" | null
  >(null);
  const [clearingPending, setClearingPending] = useState(false);
  const [cacheKey, setCacheKey] = useState(Date.now());
  const [localUrlVSeed] = useState(() => Date.now());
  const [localUrlVByIcon, setLocalUrlVByIcon] = useState<
    Record<string, number>
  >({});
  const [error, setError] = useState<string>("");
  const [generated, setGenerated] = useState<{
    source: "clipboard";
    image512Base64: string;
    image64Base64: string;
  } | null>(null);
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);
  const [pasteImageSrc, setPasteImageSrc] = useState("");
  const [pasteApplying, setPasteApplying] = useState(false);
  const [rawSaving, setRawSaving] = useState(false);
  const pasteObjectUrlRef = useRef<string | null>(null);
  const [s3PreviewOpen, setS3PreviewOpen] = useState(false);
  const [newPreviewOpen, setNewPreviewOpen] = useState(false);
  const [s3CacheBustByIcon, setS3CacheBustByIcon] = useState<
    Record<string, number>
  >({});
  const [listFilters, setListFilters] = useState(() => {
    if (deepLinkQ) {
      return { ...DEFAULT_LIST_FILTERS, nameQuery: deepLinkQ };
    }
    return readListFiltersFromStorage();
  });
  const {
    showOnlyMissingS3,
    showOnlyNotPendingSync,
    showOnlyNeedLocalUpdate,
    showOnlyRawBuffer,
    nameQuery,
  } = listFilters;

  useEffect(() => {
    if (!deepLinkQ) return;
    setListFilters({ ...DEFAULT_LIST_FILTERS, nameQuery: deepLinkQ });
  }, [deepLinkQ]);
  const [pendingSyncIcons, setPendingSyncIcons] = useState<Set<string>>(
    () => new Set(),
  );
  const [needLocalUpdateIcons, setNeedLocalUpdateIcons] = useState<Set<string>>(
    () => new Set(),
  );
  const [rawIcons, setRawIcons] = useState<Set<string>>(() => new Set());
  const [s3Cache, setS3Cache] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(S3_CACHE_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return {};
      return parsed as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const [s3Checking, setS3Checking] = useState(false);
  const [promptFromAllPrompts, setPromptFromAllPrompts] = useState(false);

  const resolvePromptForIcon = useCallback(
    (icon: string): { prompt: string; fromAllPrompts: boolean } => {
      const content = descriptions[icon] ?? "";
      return {
        prompt: composeGameIconPrompt(icon, content),
        fromAllPrompts: Boolean(content),
      };
    },
    [descriptions],
  );

  useEffect(() => {
    setGenerated(null);
    setCopied512(false);

    if (!selectedIcon) {
      setPrompt("");
      setPromptFromAllPrompts(false);
      return;
    }

    const res = resolvePromptForIcon(selectedIcon);
    setPrompt(res.prompt);
    setPromptFromAllPrompts(res.fromAllPrompts);
  }, [selectedIcon, resolvePromptForIcon]);

  useEffect(() => {
    try {
      localStorage.setItem(S3_CACHE_STORAGE_KEY, JSON.stringify(s3Cache));
    } catch {
      // ignore storage errors
    }
  }, [s3Cache]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LIST_FILTERS_STORAGE_KEY,
        JSON.stringify(listFilters),
      );
    } catch {
      // ignore storage errors
    }
  }, [listFilters]);

  const localV = (icon: string) => localUrlVByIcon[icon] ?? localUrlVSeed;

  const rawBufferUrl = selectedIcon
    ? buildRawIconUrl(selectedIcon, localV(selectedIcon))
    : "";
  const newOriginal512 = selectedIcon
    ? buildGeneratedLocalUrl(selectedIcon, localV(selectedIcon))
    : "";
  const newIcon64 = newOriginal512;
  const s3Original512 = selectedIcon
    ? buildS3Url(selectedIcon, 512, s3CacheBustByIcon[selectedIcon] ?? cacheKey)
    : "";
  const s3Icon64 = selectedIcon
    ? buildS3Url(selectedIcon, 64, s3CacheBustByIcon[selectedIcon] ?? cacheKey)
    : "";
  const iconsNotPendingSync = useMemo(
    () =>
      icons.filter(
        (icon) =>
          needLocalUpdateIcons.has(icon) && !pendingSyncIcons.has(icon),
      ),
    [icons, needLocalUpdateIcons, pendingSyncIcons],
  );
  const iconsInNeedLocalUpdate = useMemo(
    () => icons.filter((icon) => needLocalUpdateIcons.has(icon)),
    [icons, needLocalUpdateIcons],
  );
  const iconsWithRaw = useMemo(
    () => icons.filter((icon) => rawIcons.has(icon)),
    [icons, rawIcons],
  );
  const visibleIcons = useMemo(() => {
    let list = icons;
    if (showOnlyMissingS3) {
      list = list.filter((icon) => s3Cache[icon] !== true);
    }
    if (showOnlyNeedLocalUpdate) {
      list = list.filter((icon) => needLocalUpdateIcons.has(icon));
    }
    if (showOnlyNotPendingSync) {
      list = list.filter(
        (icon) =>
          needLocalUpdateIcons.has(icon) && !pendingSyncIcons.has(icon),
      );
    }
    if (kind === "ui") {
      list = [];
    } else {
      list = list.filter((icon) => gameIconImgKind(icon) === kind);
    }
    if (showOnlyRawBuffer) {
      list = list.filter((icon) => rawIcons.has(icon));
    }
    const nameNeedle = nameQuery.trim().toLowerCase();
    if (nameNeedle) {
      list = list.filter((icon) => {
        if (icon.toLowerCase().includes(nameNeedle)) return true;
        const legacy = resolveGameIconLegacyRef(icon, iconRenameMap);
        return (
          legacy !== icon && legacy.toLowerCase().includes(nameNeedle)
        );
      });
    }
    return list;
  }, [
    icons,
    iconRenameMap,
    kind,
    nameQuery,
    needLocalUpdateIcons,
    pendingSyncIcons,
    rawIcons,
    s3Cache,
    showOnlyMissingS3,
    showOnlyNeedLocalUpdate,
    showOnlyNotPendingSync,
    showOnlyRawBuffer,
  ]);

  const markPendingLocal = useCallback((icon: string) => {
    setPendingSyncIcons((prev) => {
      if (prev.has(icon)) return prev;
      const next = new Set(prev);
      next.add(icon);
      return next;
    });
  }, []);

  const clearPendingLocal = useCallback((icon: string) => {
    setPendingSyncIcons((prev) => {
      if (!prev.has(icon)) return prev;
      const next = new Set(prev);
      next.delete(icon);
      return next;
    });
  }, []);

  const clearNeedLocalUpdateLocal = useCallback((icon: string) => {
    setNeedLocalUpdateIcons((prev) => {
      if (!prev.has(icon)) return prev;
      const next = new Set(prev);
      next.delete(icon);
      return next;
    });
  }, []);

  const selectNextIfNotPendingFilter = useCallback(
    (icon: string) => {
      if (!showOnlyNotPendingSync) return;
      const next = selectNextAfterRemoval(visibleIcons, icon);
      setSelectedIcon(next ?? "");
    },
    [showOnlyNotPendingSync, visibleIcons],
  );
  const totalPages = Math.max(1, Math.ceil(visibleIcons.length / PAGE_SIZE));
  const pagedIcons = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return visibleIcons.slice(start, start + PAGE_SIZE);
  }, [visibleIcons, page]);

  const checkS3IconExists = (icon: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = buildS3Url(icon, 64, 0);
    });
  };

  const ensureS3StatusForIcons = async (
    targetIcons: string[],
  ): Promise<Record<string, boolean>> => {
    const uniqueIcons = [...new Set(targetIcons)].filter(
      (icon) => s3Cache[icon] === undefined,
    );
    if (uniqueIcons.length === 0) return s3Cache;

    setS3Checking(true);
    const updates: Record<string, boolean> = {};
    try {
      for (let i = 0; i < uniqueIcons.length; i += S3_CHECK_CONCURRENCY) {
        const chunk = uniqueIcons.slice(i, i + S3_CHECK_CONCURRENCY);
        const results = await Promise.all(
          chunk.map(async (icon) => ({
            icon,
            exists: await checkS3IconExists(icon),
          })),
        );
        for (const result of results) {
          updates[result.icon] = result.exists;
        }
      }
      if (Object.keys(updates).length > 0) {
        setS3Cache((prev) => ({ ...prev, ...updates }));
      }
      return { ...s3Cache, ...updates };
    } finally {
      setS3Checking(false);
    }
  };

  useEffect(() => {
    void ensureS3StatusForIcons(pagedIcons);
  }, [pagedIcons]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    setPageInput(String(Math.min(page, totalPages)));
  }, [page, totalPages]);

  useEffect(() => {
    if (!deepLinkQ) return;
    if (!icons.includes(deepLinkQ)) return;
    if (kind !== "ui" && gameIconImgKind(deepLinkQ) !== kind) return;
    setSelectedIcon(deepLinkQ);
  }, [deepLinkQ, icons, kind]);

  useEffect(() => {
    if (!deepLinkQ) return;
    const idx = visibleIcons.indexOf(deepLinkQ);
    if (idx < 0) return;
    setPage(Math.floor(idx / PAGE_SIZE) + 1);
  }, [deepLinkQ, visibleIcons]);

  const prevVisibleIconsRef = useRef(visibleIcons);
  useEffect(() => {
    const prevVisible = prevVisibleIconsRef.current;
    prevVisibleIconsRef.current = visibleIcons;

    if (!visibleIcons.length) {
      setSelectedIcon("");
      return;
    }
    if (visibleIcons.includes(selectedIcon)) return;

    const next = prevVisible.length
      ? selectNextAfterRemoval(prevVisible, selectedIcon)
      : visibleIcons[0];
    setSelectedIcon(next ?? visibleIcons[0] ?? "");
  }, [visibleIcons, selectedIcon]);

  const closePasteDialog = useCallback(() => {
    setPasteDialogOpen(false);
    setPasteImageSrc("");
    if (pasteObjectUrlRef.current) {
      URL.revokeObjectURL(pasteObjectUrlRef.current);
      pasteObjectUrlRef.current = null;
    }
  }, []);

  const openPasteDialogWithBlob = useCallback(
    (blob: Blob) => {
      if (!selectedIcon) {
        setError("Сначала выберите иконку");
        return;
      }
      if (pasteObjectUrlRef.current) {
        URL.revokeObjectURL(pasteObjectUrlRef.current);
      }
      const url = URL.createObjectURL(blob);
      pasteObjectUrlRef.current = url;
      setPasteImageSrc(url);
      setPasteDialogOpen(true);
      setError("");
    },
    [selectedIcon],
  );

  const handlePasteFromClipboard = useCallback(async () => {
    if (!selectedIcon) {
      setError("Сначала выберите иконку");
      return;
    }
    setError("");
    try {
      const blob = await readClipboardImageBlob();
      if (!blob) {
        setError(
          "В буфере обмена нет изображения (скопируйте картинку и повторите)",
        );
        return;
      }
      openPasteDialogWithBlob(blob);
    } catch (e) {
      setError((e as Error).message || "Не удалось прочитать буфер обмена");
    }
  }, [openPasteDialogWithBlob, selectedIcon]);

  const handleLoadFromLocalFile = useCallback(
    (file: File | undefined) => {
      if (!selectedIcon) {
        setError("Сначала выберите иконку");
        return;
      }
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError("Выберите файл изображения");
        return;
      }
      setError("");
      openPasteDialogWithBlob(file);
    },
    [openPasteDialogWithBlob, selectedIcon],
  );

  const handleSaveRawBlob = useCallback(
    async (blob: Blob): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!selectedIcon) {
        const error = "Сначала выберите иконку";
        setError(error);
        return { ok: false, error };
      }
      setRawSaving(true);
      setError("");
      try {
        const imageBase64 = await blobToBase64(blob);
        await adminApi.saveGameIconRaw({ icon: selectedIcon, imageBase64 });
        setRawIcons((prev) => {
          if (prev.has(selectedIcon)) return prev;
          const next = new Set(prev);
          next.add(selectedIcon);
          return next;
        });
        setLocalUrlVByIcon((prev) => ({
          ...prev,
          [selectedIcon]: Date.now(),
        }));
        return { ok: true };
      } catch (e) {
        const error = readApiErrorMessage(e, "Не удалось сохранить сырой буфер");
        setError(error);
        return { ok: false, error };
      } finally {
        setRawSaving(false);
      }
    },
    [selectedIcon],
  );

  /** Gemini autofill: raw → All-raw, сразу apply в All-512-new (raw остаётся для ручного кропа). */
  const handleSaveRawAndApplyBlob = useCallback(
    async (blob: Blob): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!selectedIcon) {
        const error = "Сначала выберите иконку";
        setError(error);
        return { ok: false, error };
      }
      const icon = selectedIcon;
      setRawSaving(true);
      setPasteApplying(true);
      setError("");
      try {
        const imageBase64 = await blobToBase64(blob);
        await adminApi.saveGameIconRaw({ icon, imageBase64 });
        setRawIcons((prev) => {
          if (prev.has(icon)) return prev;
          const next = new Set(prev);
          next.add(icon);
          return next;
        });
        const { data } = await adminApi.applyGameIconRaw(icon);
        setGenerated(data);
        setLocalUrlVByIcon((prev) => ({
          ...prev,
          [icon]: Date.now(),
        }));
        markPendingLocal(icon);
        selectNextIfNotPendingFilter(icon);
        setRetouchMaskBase64(null);
        setRetouchResetKey((prev) => prev + 1);
        return { ok: true };
      } catch (e) {
        const error = readApiErrorMessage(
          e,
          "Не удалось сохранить сырой буфер и применить в 512",
        );
        setError(error);
        return { ok: false, error };
      } finally {
        setRawSaving(false);
        setPasteApplying(false);
      }
    },
    [markPendingLocal, selectNextIfNotPendingFilter, selectedIcon],
  );

  const handleSaveRawFromClipboard = useCallback(async () => {
    if (!selectedIcon) {
      setError("Сначала выберите иконку");
      return;
    }
    setError("");
    try {
      const blob = await readClipboardImageBlob();
      if (!blob) {
        setError(
          "В буфере обмена нет изображения (скопируйте картинку и повторите)",
        );
        return;
      }
      await handleSaveRawBlob(blob);
    } catch (e) {
      setError((e as Error).message || "Не удалось прочитать буфер обмена");
    }
  }, [handleSaveRawBlob, selectedIcon]);

  const handleSaveRawFromFile = useCallback(
    (file: File | undefined) => {
      if (!selectedIcon) {
        setError("Сначала выберите иконку");
        return;
      }
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError("Выберите файл изображения");
        return;
      }
      void handleSaveRawBlob(file);
    },
    [handleSaveRawBlob, selectedIcon],
  );

  const handleCropFromRaw = useCallback(async () => {
    if (!selectedIcon) {
      setError("Сначала выберите иконку");
      return;
    }
    setError("");
    try {
      const response = await fetch(buildRawIconUrl(selectedIcon, Date.now()));
      if (!response.ok) {
        setError("В сыром буфере нет картинки");
        return;
      }
      openPasteDialogWithBlob(await response.blob());
    } catch (e) {
      setError(readApiErrorMessage(e, "Не удалось открыть сырой буфер"));
    }
  }, [openPasteDialogWithBlob, selectedIcon]);

  const handleApplyRawAsIs = async () => {
    if (!selectedIcon) return;
    setPasteApplying(true);
    setError("");
    try {
      const { data } = await adminApi.applyGameIconRaw(selectedIcon);
      setGenerated(data);
      setLocalUrlVByIcon((prev) => ({
        ...prev,
        [selectedIcon]: Date.now(),
      }));
      markPendingLocal(selectedIcon);
      selectNextIfNotPendingFilter(selectedIcon);
    } catch (e) {
      setError(readApiErrorMessage(e, "Не удалось применить сырой буфер"));
    } finally {
      setPasteApplying(false);
    }
  };

  const handleDeleteRaw = async () => {
    if (!selectedIcon) return;
    setRawSaving(true);
    setError("");
    try {
      await adminApi.deleteGameIconRaw(selectedIcon);
      setRawIcons((prev) => {
        if (!prev.has(selectedIcon)) return prev;
        const next = new Set(prev);
        next.delete(selectedIcon);
        return next;
      });
      setLocalUrlVByIcon((prev) => ({
        ...prev,
        [selectedIcon]: Date.now(),
      }));
    } catch (e) {
      setError(readApiErrorMessage(e, "Не удалось удалить сырой буфер"));
    } finally {
      setRawSaving(false);
    }
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      // При выбранной иконке Ctrl+V с картинкой = «Вставить из буфера обмена»
      // (даже если фокус в TextField промпта — кликать никуда не нужно).
      if (!selectedIcon || pasteDialogOpen || pasteApplying) return;
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (!item.type.startsWith("image/")) continue;
        const blob = item.getAsFile();
        if (!blob) continue;
        event.preventDefault();
        openPasteDialogWithBlob(blob);
        return;
      }
    };
    // Chrome-расширение Шедеврума: blob уже прочитан в content script
    // (кнопка «Вставить из буфера обмена» в page-world часто не видит image).
    const onExtPaste = (event: Event) => {
      const detail = (event as CustomEvent<{ blob?: Blob }>).detail;
      if (!detail?.blob) return;
      if (!selectedIcon || pasteDialogOpen || pasteApplying) return;
      openPasteDialogWithBlob(detail.blob);
    };
    const onExtClearError = () => setError("");
    const onExtSaveRaw = (event: Event) => {
      const detail = (event as CustomEvent<{ blob?: Blob }>).detail;
      const report = (result: { ok: boolean; error?: string }) => {
        window.dispatchEvent(
          new CustomEvent("l-fight-admin-save-raw-result", { detail: result }),
        );
      };
      if (!detail?.blob) {
        report({ ok: false, error: "нет изображения" });
        return;
      }
      if (!selectedIcon || pasteDialogOpen || pasteApplying || rawSaving) {
        report({
          ok: false,
          error: "иконка не выбрана или идёт другая загрузка",
        });
        return;
      }
      // Gemini: raw + сразу All-512-new; raw остаётся для ручного «Кроп из сырого буфера».
      void handleSaveRawAndApplyBlob(detail.blob).then((result) =>
        report(result),
      );
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("l-fight-admin-paste-image", onExtPaste);
    window.addEventListener("l-fight-admin-save-raw-image", onExtSaveRaw);
    window.addEventListener("l-fight-admin-clear-error", onExtClearError);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("l-fight-admin-paste-image", onExtPaste);
      window.removeEventListener("l-fight-admin-save-raw-image", onExtSaveRaw);
      window.removeEventListener("l-fight-admin-clear-error", onExtClearError);
    };
  }, [
    handleSaveRawAndApplyBlob,
    openPasteDialogWithBlob,
    pasteApplying,
    pasteDialogOpen,
    rawSaving,
    selectedIcon,
  ]);

  useEffect(() => {
    return () => {
      if (pasteObjectUrlRef.current) {
        URL.revokeObjectURL(pasteObjectUrlRef.current);
      }
    };
  }, []);

  const handlePasteCropApply = async (imageBase64: string) => {
    if (!selectedIcon) return;
    setPasteApplying(true);
    setError("");
    try {
      const { data } = await adminApi.fromClipboardGameIcon({
        icon: selectedIcon,
        imageBase64,
      });
      setGenerated(data);
      setLocalUrlVByIcon((prev) => ({
        ...prev,
        [selectedIcon]: Date.now(),
      }));
      markPendingLocal(selectedIcon);
      selectNextIfNotPendingFilter(selectedIcon);
      closePasteDialog();
    } catch (e) {
      setError(readApiErrorMessage(e, "Не удалось загрузить из буфера обмена"));
    } finally {
      setPasteApplying(false);
    }
  };

  const handleCopy512ToClipboard = async () => {
    if (!selectedIcon || !newOriginal512) return;
    setCopying512(true);
    setCopied512(false);
    setError("");
    try {
      const res = await fetch(newOriginal512, { cache: "no-store" });
      if (!res.ok) throw new Error("Нет локальной 512");
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Не удалось подготовить PNG");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Не удалось сделать PNG"))),
          "image/png",
        );
      });
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": png }),
      ]);
      setCopied512(true);
    } catch (e) {
      setError(
        (e as Error).message || "Не удалось скопировать 512 в буфер обмена",
      );
    } finally {
      setCopying512(false);
    }
  };

  const handleCopyPrompt = async () => {
    const text = prompt.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API недоступен
    }
  };


  const handleApply = async () => {
    if (!selectedIcon) return;
    const syncedIcon = selectedIcon;
    setError("");
    setApplying(true);
    try {
      await adminApi.applyGameIcon({
        icon: syncedIcon,
      });
      setS3CacheBustByIcon((prev) => ({
        ...prev,
        [syncedIcon]: Date.now(),
      }));
      clearPendingLocal(syncedIcon);
      clearNeedLocalUpdateLocal(syncedIcon);
      if (
        showOnlyMissingS3 ||
        showOnlyNotPendingSync ||
        showOnlyNeedLocalUpdate
      ) {
        const next = selectNextAfterRemoval(visibleIcons, syncedIcon);
        setSelectedIcon(next ?? "");
      }
      setS3Cache((prev) => ({ ...prev, [syncedIcon]: true }));
    } catch (e) {
      setError((e as Error).message || "Не удалось синхронизировать");
    } finally {
      setApplying(false);
    }
  };

  const handleRestoreFromS3 = async () => {
    if (!selectedIcon) return;
    const icon = selectedIcon;
    setError("");
    setRestoringFromS3(true);
    try {
      const { data } = await adminApi.restoreGameIconFromS3(icon);
      setGenerated({
        source: "clipboard",
        image512Base64: data.image512Base64,
        image64Base64: data.image64Base64,
      });
      setRawIcons((prev) => {
        if (prev.has(icon)) return prev;
        const next = new Set(prev);
        next.add(icon);
        return next;
      });
      setLocalUrlVByIcon((prev) => ({
        ...prev,
        [icon]: Date.now(),
      }));
    } catch (e) {
      setError(
        readApiErrorMessage(e, "Не удалось восстановить иконку из S3"),
      );
    } finally {
      setRestoringFromS3(false);
    }
  };

  const handleTransformLocal = async (
    op: "flipHorizontal" | "rotate180",
  ) => {
    if (!selectedIcon || transformingLocalOp) return;
    const icon = selectedIcon;
    setError("");
    setTransformingLocalOp(op);
    try {
      const { data } = await adminApi.transformGameIconLocal({ icon, op });
      if (data.image512Base64 && data.image64Base64) {
        setGenerated({
          source: "clipboard",
          image512Base64: data.image512Base64,
          image64Base64: data.image64Base64,
        });
        markPendingLocal(icon);
      }
      setLocalUrlVByIcon((prev) => ({
        ...prev,
        [icon]: Date.now(),
      }));
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
      setTransformingLocalOp(null);
    }
  };

  const handleClearPendingMark = async () => {
    if (!selectedIcon) return;
    const icon = selectedIcon;
    setError("");
    setClearingPending(true);
    try {
      const { data } = await adminApi.clearGameIconPendingSync(icon);
      setPendingSyncIcons(new Set(data.icons ?? []));
      setNeedLocalUpdateIcons(new Set(data.needLocalUpdateIcons ?? []));
      clearPendingLocal(icon);
      setGenerated(null);
      setLocalUrlVByIcon((prev) => ({
        ...prev,
        [icon]: Date.now(),
      }));
      setNewPreviewOpen(false);
    } catch (e) {
      setError(
        (e as Error).message ||
          "Не удалось сбросить локальную подготовку",
      );
    } finally {
      setClearingPending(false);
    }
  };


  const handleResetS3Cache = () => {
    setS3Cache({});
    setCacheKey(Date.now());
  };


  const handlePageInputCommit = () => {
    const parsed = Number(pageInput.trim());
    if (!Number.isFinite(parsed)) {
      setPageInput(String(Math.min(page, totalPages)));
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
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              size="small"
              variant="outlined"
              onClick={handleResetS3Cache}
              disabled={s3Checking}
            >
              Сбросить кеш S3
            </Button>
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            justifyContent="space-between"
          >
            <Stack direction="column" spacing={0}>
              <TextField
                size="small"
                label="Имя иконки"
                value={nameQuery}
                onChange={(e) => {
                  const nextName = e.target.value;
                  setListFilters((prev) => ({
                    ...prev,
                    nameQuery: nextName,
                  }));
                  setPage(1);
                }}
                placeholder="s2153 или часть имени"
                sx={{ mt: 0.5, mb: 0.5 }}
              />
              <FormControlLabel
                sx={{ ml: 0 }}
                control={
                  <Switch
                    checked={showOnlyMissingS3}
                    onChange={(e) =>
                      setListFilters((prev) => ({
                        ...prev,
                        showOnlyMissingS3: e.target.checked,
                      }))
                    }
                  />
                }
                label="Только без S3"
              />
              <FormControlLabel
                sx={{ ml: 0 }}
                control={
                  <Switch
                    checked={showOnlyNotPendingSync}
                    onChange={(e) =>
                      setListFilters((prev) => ({
                        ...prev,
                        showOnlyNotPendingSync: e.target.checked,
                      }))
                    }
                  />
                }
                label={`Ещё не обновлены локально${
                  iconsNotPendingSync.length
                    ? ` (${iconsNotPendingSync.length})`
                    : ""
                }`}
              />
              <FormControlLabel
                sx={{ ml: 0 }}
                control={
                  <Switch
                    checked={showOnlyNeedLocalUpdate}
                    onChange={(e) =>
                      setListFilters((prev) => ({
                        ...prev,
                        showOnlyNeedLocalUpdate: e.target.checked,
                      }))
                    }
                  />
                }
                label={`Ещё не обновлены в S3 (need-local-update)${
                  iconsInNeedLocalUpdate.length
                    ? ` (${iconsInNeedLocalUpdate.length})`
                    : ""
                }`}
              />
              <FormControlLabel
                sx={{ ml: 0 }}
                control={
                  <Switch
                    checked={showOnlyRawBuffer}
                    onChange={(e) =>
                      setListFilters((prev) => ({
                        ...prev,
                        showOnlyRawBuffer: e.target.checked,
                      }))
                    }
                  />
                }
                label={`Есть сырой буфер${
                  iconsWithRaw.length ? ` (${iconsWithRaw.length})` : ""
                }`}
              />
              
            </Stack>
          </Stack>
          <Pagination
            count={totalPages}
            page={Math.min(page, totalPages)}
            onChange={(_e, value) => setPage(value)}
            size="small"
            showFirstButton
            showLastButton
          />
          <TextField
            size="small"
            label="Страница"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={handlePageInputCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handlePageInputCommit();
              }
            }}
            inputProps={{
              inputMode: "numeric",
              pattern: "[0-9]*",
              min: 1,
              max: totalPages,
            }}
            sx={{ maxWidth: 120 }}
          />
          {s3Checking ? (
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              Проверка S3...
            </Typography>
          ) : null}
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
                src={buildRawIconUrl(icon, localV(icon))}
                size={ADMIN_GAME_ICON_LIST_PREVIEW_SIZES.raw}
                alt={`${icon} raw buffer`}
              />
              <PreviewImage
                src={buildGeneratedLocalUrl(icon, localV(icon))}
                size={ADMIN_GAME_ICON_LIST_PREVIEW_SIZES.approved}
                alt={`${icon} approved`}
              />
              <PreviewImage
                src={buildS3Url(icon, 64, s3CacheBustByIcon[icon] ?? cacheKey)}
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
            Редактор иконки:{" "}
            {selectedIcon
              ? formatEditorIconLabel(selectedIcon, iconRenameMap)
              : "-"}
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}

          <Stack spacing={1.5}>
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
                Загрузить оригинал в буферную зону (All-raw), без кропа и без
                Sync
              </Typography>
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
              >
                <Button
                  variant="outlined"
                  onClick={() => void handleSaveRawFromClipboard()}
                  disabled={
                    !selectedIcon || pasteApplying || rawSaving
                  }
                >
                  В сырой буфер из буфера обмена
                </Button>
                <Button
                  variant="outlined"
                  component="label"
                  disabled={
                    !selectedIcon || pasteApplying || rawSaving
                  }
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
                <Button
                  variant="outlined"
                  color="inherit"
                  onClick={() => void handleDeleteRaw()}
                  disabled={
                    !selectedIcon ||
                    !rawIcons.has(selectedIcon) ||
                    pasteApplying ||
                    rawSaving
                  }
                >
                  Удалить сырой буфер
                </Button>
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
              <Typography variant="subtitle2">
                2. Подготовка (локально 512)
              </Typography>
              <Typography
                variant="caption"
                sx={{ display: "block", mb: 1, opacity: 0.75 }}
              >
                Из сырого буфера — в All-512-new (pending). Либо сразу кроп из
                буфера обмена / с диска
              </Typography>
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
              >
                <Button
                  variant="outlined"
                  onClick={() => void handleApplyRawAsIs()}
                  disabled={
                    !selectedIcon ||
                    !rawIcons.has(selectedIcon) ||
                    pasteApplying ||
                    rawSaving
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
                    pasteApplying ||
                    rawSaving
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
                  onClick={() => void handlePasteFromClipboard()}
                  disabled={!selectedIcon || pasteApplying}
                >
                  Вставить из буфера обмена
                </Button>
                <Button
                  variant="outlined"
                  component="label"
                  disabled={!selectedIcon || pasteApplying}
                >
                  Загрузить с диска
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      handleLoadFromLocalFile(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </Button>
                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                  Ctrl+V — то же при выбранной иконке
                </Typography>
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
                  onClick={() => void handleTransformLocal("flipHorizontal")}
                  disabled={
                    !selectedIcon ||
                    pasteApplying ||
                    transformingLocalOp != null ||
                    restoringFromS3
                  }
                  title="Зеркально отразить All-raw и локальную 512 по горизонтали"
                >
                  {transformingLocalOp === "flipHorizontal" ? (
                    <CircularProgress size={16} />
                  ) : (
                    "Зеркало ←→"
                  )}
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => void handleTransformLocal("rotate180")}
                  disabled={
                    !selectedIcon ||
                    pasteApplying ||
                    transformingLocalOp != null ||
                    restoringFromS3
                  }
                  title="Повернуть All-raw и локальную 512 на 180°"
                >
                  {transformingLocalOp === "rotate180" ? (
                    <CircularProgress size={16} />
                  ) : (
                    "Поворот 180°"
                  )}
                </Button>
                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                  Переворачивает сырой буфер и локальную 512 (если есть)
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
                Залить подготовленную локальную 512/64 в S3
              </Typography>
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
              >
                <Button
                  variant="contained"
                  color="warning"
                  onClick={handleApply}
                  disabled={applying || !selectedIcon}
                >
                  {applying ? <CircularProgress size={18} /> : "Sync"}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
                  onClick={() => void handleClearPendingMark()}
                  disabled={clearingPending || !selectedIcon}
                  title="Удалить All-512-new PNG, убрать из pending-s3-sync, добавить в need-local-update (можно после Sync)"
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

          <Stack direction="row" spacing={2} alignItems="flex-start">
            <Box sx={{ width: 240, flexShrink: 0 }}>
              <Typography variant="caption">Сырой буфер</Typography>
              <PreviewImage
                src={rawBufferUrl}
                size={64}
                alt="raw buffer"
              />
            </Box>
            <Box>
              <Typography variant="caption">New 512</Typography>
              <Box
                component="button"
                type="button"
                onClick={() => setNewPreviewOpen(true)}
                disabled={!selectedIcon}
                sx={{
                  all: "unset",
                  cursor: selectedIcon ? "zoom-in" : "not-allowed",
                  display: "inline-block",
                }}
              >
                <PreviewImage
                  src={newIcon64}
                  size={512}
                  alt="generated 512 preview"
                />
              </Box>
            </Box>
            <Box>
              <Typography variant="caption">New 64</Typography>
              <PreviewImage
                src={newOriginal512}
                size={64}
                alt="generated 64 preview"
              />
              <Box sx={{ mt: 0.75 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => void handleCopy512ToClipboard()}
                  disabled={copying512 || !selectedIcon}
                  title="Скопировать локальную All-512-new в буфер обмена"
                >
                  {copying512 ? (
                    <CircularProgress size={16} />
                  ) : copied512 ? (
                    "скопировано"
                  ) : (
                    "в буфер обмена 512"
                  )}
                </Button>
              </Box>
            </Box>
            <Box>
              <Typography variant="caption">S3 64</Typography>
              <Box
                component="button"
                type="button"
                onClick={() => setS3PreviewOpen(true)}
                sx={{
                  all: "unset",
                  cursor: "zoom-in",
                  display: "inline-block",
                }}
              >
                <PreviewImage src={s3Icon64} size={64} alt="s3 64" />
              </Box>
              <Box sx={{ mt: 0.75 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => void handleRestoreFromS3()}
                  disabled={restoringFromS3 || !selectedIcon}
                  title="Скачать S3 512 → сырой буфер + All-512-new (JSON не трогает)"
                >
                  {restoringFromS3 ? (
                    <CircularProgress size={16} />
                  ) : (
                    "restore"
                  )}
                </Button>
              </Box>
            </Box>
          </Stack>

          <Divider />
          <Typography
            variant="caption"
            sx={{ color: "rgba(255,255,255,0.65)" }}
          >
            Промпт = общая часть (стиль) +{" "}
            <Typography
              component="span"
              variant="caption"
              sx={{ opacity: 0.9 }}
            >
              description
            </Typography>{" "}
            из item-icons / skill-icons. Можно отредактировать перед копированием.
          </Typography>
          {promptFromAllPrompts ? (
            <Typography
              variant="caption"
              sx={{ color: "success.light", display: "block" }}
            >
              Есть description
            </Typography>
          ) : null}
          <Box>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={() => void handleCopyPrompt()}
              disabled={!prompt.trim()}
              sx={{ mb: 1 }}
            >
              Скопировать промпт
            </Button>
            <TextField
              multiline
              minRows={4}
              fullWidth
              label="Промпт"
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setPromptFromAllPrompts(false);
              }}
            />
          </Box>
          {generated ? (
            <Stack spacing={1}>
              <Typography variant="body2">
                Результат генерации ({generated.source})
              </Typography>
              <Stack direction="row" spacing={2}>
                <Box>
                  <Typography variant="caption">Original 512</Typography>
                  <PreviewImage
                    src={toDataUrl(generated.image512Base64, "image/png")}
                    size={512}
                    alt="generated 512"
                  />
                </Box>
                <Box>
                  <Typography variant="caption">Icon 64</Typography>
                  <PreviewImage
                    src={toDataUrl(generated.image64Base64, "image/jpeg")}
                    size={64}
                    alt="generated 64"
                  />
                </Box>
              </Stack>
            </Stack>
          ) : null}

        </Stack>
      </Paper>
      <Dialog
        open={s3PreviewOpen}
        onClose={() => setS3PreviewOpen(false)}
        maxWidth={false}
      >
        <Box sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            S3 512 Preview
          </Typography>
          <PreviewImage
            src={s3Original512}
            size={512}
            alt="s3 512 modal preview"
          />
        </Box>
      </Dialog>
      <Dialog
        open={newPreviewOpen}
        onClose={() => setNewPreviewOpen(false)}
        maxWidth={false}
      >
        <Box sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            New 512 Preview
          </Typography>
          <PreviewImage
            src={newOriginal512}
            size={512}
            alt="generated 512 modal preview"
          />
        </Box>
      </Dialog>
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
