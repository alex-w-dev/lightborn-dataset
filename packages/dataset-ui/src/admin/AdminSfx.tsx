import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Slider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_SFX_IDS,
  expandSfxCatalog,
  parseSfxAssetKey,
  type SfxCatalogEntry,
  type SfxCatalogFile,
  type SfxId,
} from "../sfx/SfxId";
import { datasetAdminApi as adminApi } from "./datasetAdminApi";
import { useSearchParams } from "react-router-dom";
import { clientPublicUrl } from "../clientPublicUrl";
import AdminSfxCutDialog, {
  type SfxCutSegment,
} from "./AdminSfxCutDialog";

type SfxMetaRow = { id: string; description: string };

const CATEGORY_LABELS: Record<string, string> = {
  ui: "UI",
  map: "Карта",
  farm: "Фарм",
  battle: "Бой",
  hit: "Хиты",
  cast: "Касты",
  skill: "Скиллы",
  potion: "Зелья",
  summon: "Суммон",
  dot: "DoT",
  item: "Предметы",
  gold: "Золото",
  enchant: "Заточка",
  energy: "Энергитация",
  chest: "Сундуки",
  shop: "Магазин",
  black: "Чёрный рынок",
  craft: "Крафт",
  warehouse: "Склад",
  auction: "Аукцион",
  trade: "Трейд",
  quest: "Квесты",
  npc: "NPC",
  party: "Пати",
  chat: "Чат",
};

function categoryOf(id: SfxId): string {
  const rest = id.replace(/^sfx_/, "");
  const [head] = rest.split("_");
  return head || "other";
}

function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key] ?? key;
}

function sfxAssetUrl(assetKey: string, cacheBust?: number): string {
  return clientPublicUrl(`sfx/${assetKey}/original.ogg`, cacheBust);
}

function entryLabel(entry: SfxCatalogEntry): string {
  if (entry.variantCount <= 1) return entry.assetKey;
  return `${entry.assetKey} (${entry.variant}/${entry.variantCount})`;
}

export default function AdminSfx() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [volume, setVolume] = useState(0.7);
  const [lastPlayed, setLastPlayed] = useState<string | null>(null);
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({});
  const [cacheBustByKey, setCacheBustByKey] = useState<Record<string, number>>(
    {},
  );
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [sfxCatalog, setSfxCatalog] = useState<SfxCatalogFile | null>(null);
  const [metaById, setMetaById] = useState<Record<string, string>>({});
  const [draftById, setDraftById] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    severity: "success" | "error";
    text: string;
  } | null>(null);
  const [cutOpen, setCutOpen] = useState(false);
  const [cutFile, setCutFile] = useState<File | null>(null);
  const [cutBaseId, setCutBaseId] = useState("sfx_ui_click");
  const [cutStartVariant, setCutStartVariant] = useState(1);
  const [cutAssetKey, setCutAssetKey] = useState<string | null>(null);

  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadKeyRef = useRef<string | null>(null);

  const reloadCatalog = useCallback(async () => {
    try {
      const [{ data }, metaRes] = await Promise.all([
        adminApi.getSfxCatalog(),
        adminApi.getDatasetRaw<SfxMetaRow[]>("sfx"),
      ]);
      setSfxCatalog(data ?? {});
      const map: Record<string, string> = {};
      for (const row of Array.isArray(metaRes.data) ? metaRes.data : []) {
        const id = String(row.id ?? "").trim();
        if (!id) continue;
        map[id] = String(row.description ?? "");
      }
      setMetaById(map);
      setDraftById(map);
      setCatalogError(null);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Не удалось загрузить catalog.json / sfx.json";
      setCatalogError(String(message));
      setSfxCatalog({});
    }
  }, []);

  useEffect(() => {
    void reloadCatalog();
  }, [reloadCatalog]);

  const catalog = useMemo(
    () => expandSfxCatalog(ALL_SFX_IDS, sfxCatalog),
    [sfxCatalog],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((entry) => {
      const description = (metaById[entry.id] ?? "").toLowerCase();
      return (
        entry.assetKey.toLowerCase().includes(q) ||
        entry.id.toLowerCase().includes(q) ||
        description.includes(q)
      );
    });
  }, [catalog, query, metaById]);

  const saveDescription = async (id: SfxId) => {
    const description = draftById[id] ?? "";
    try {
      setSavingId(id);
      setBanner(null);
      const nextRows: SfxMetaRow[] = ALL_SFX_IDS.map((sfxId) => ({
        id: sfxId,
        description:
          sfxId === id ? description : (metaById[sfxId] ?? draftById[sfxId] ?? ""),
      }));
      await adminApi.putDatasetRaw("sfx", nextRows);
      setMetaById((prev) => ({ ...prev, [id]: description }));
      setBanner({ severity: "success", text: `Описание сохранено: ${id}` });
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })
          ?.response?.data?.message || "Не удалось сохранить описание";
      const text = Array.isArray(message) ? message.join(", ") : String(message);
      setBanner({ severity: "error", text });
    } finally {
      setSavingId(null);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, SfxCatalogEntry[]>();
    for (const entry of filtered) {
      const cat = categoryOf(entry.id);
      const list = map.get(cat);
      if (list) list.push(entry);
      else map.set(cat, [entry]);
    }
    return [...map.entries()]
      .sort(([a], [b]) =>
        categoryLabel(a).localeCompare(categoryLabel(b), "ru"),
      )
      .map(([cat, entries]) => {
        // Варианты одного id — одна группа; каждая группа с новой строки.
        const byId = new Map<SfxId, SfxCatalogEntry[]>();
        for (const entry of entries) {
          const list = byId.get(entry.id);
          if (list) list.push(entry);
          else byId.set(entry.id, [entry]);
        }
        return [cat, [...byId.values()]] as const;
      });
  }, [filtered]);

  const play = (assetKey: string) => {
    const audio = new Audio(sfxAssetUrl(assetKey, cacheBustByKey[assetKey]));
    audio.volume = Math.max(0, Math.min(1, volumeRef.current));
    setLastPlayed(assetKey);
    void audio.play().then(
      () => {
        setErrorByKey((prev) => {
          if (!prev[assetKey]) return prev;
          const next = { ...prev };
          delete next[assetKey];
          return next;
        });
      },
      (err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Не удалось воспроизвести";
        setErrorByKey((prev) => ({ ...prev, [assetKey]: message }));
      },
    );
  };

  const openUploadPicker = (assetKey: string) => {
    pendingUploadKeyRef.current = assetKey;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const onFileSelected = (file: File | undefined) => {
    const assetKey = pendingUploadKeyRef.current;
    pendingUploadKeyRef.current = null;
    if (!assetKey || !file) return;
    const { id, variant } = parseSfxAssetKey(assetKey);
    setCutAssetKey(assetKey);
    setCutBaseId(id);
    setCutStartVariant(variant);
    setCutFile(file);
    setCutOpen(true);
  };

  const closeCut = () => {
    if (uploadingKey) return;
    setCutOpen(false);
    setCutFile(null);
    setCutAssetKey(null);
  };

  const onConfirmCut = async (segments: SfxCutSegment[]) => {
    if (!cutFile || !cutAssetKey) return;
    try {
      setUploadingKey(cutAssetKey);
      setBanner(null);
      const { data } = await adminApi.uploadSfxSlices(cutBaseId, cutFile, {
        startVariant: cutStartVariant,
        segments,
      });
      const bust = Date.now();
      setCacheBustByKey((prev) => {
        const next = { ...prev };
        for (const w of data.written) {
          next[w.assetKey] = bust;
        }
        return next;
      });
      await reloadCatalog();
      setBanner({
        severity: "success",
        text: `Записано ${data.written.length} фрагм. для ${cutBaseId} (variants=${data.variants}): ${data.written
          .map((w) => `${w.assetKey} ${Math.round(w.volume * 100)}%`)
          .join(", ")}`,
      });
      const first = data.written[0]?.assetKey;
      if (first) {
        const audio = new Audio(sfxAssetUrl(first, bust));
        audio.volume = Math.max(0, Math.min(1, volumeRef.current));
        setLastPlayed(first);
        void audio.play().catch(() => undefined);
      }
      setCutOpen(false);
      setCutFile(null);
      setCutAssetKey(null);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })
          ?.response?.data?.message || "Ошибка загрузки";
      const text = Array.isArray(message) ? message.join(", ") : String(message);
      setBanner({
        severity: "error",
        text: `${cutBaseId}@${cutStartVariant}: ${text}`,
      });
    } finally {
      setUploadingKey(null);
    }
  };

  const onDeleteVariant = async (entry: SfxCatalogEntry) => {
    if (entry.variantCount <= 1) return;
    const ok = window.confirm(
      `Удалить ${entry.assetKey}? Остальные варианты сдвинутся вниз (переименование файлов).`,
    );
    if (!ok) return;
    try {
      setUploadingKey(entry.assetKey);
      setBanner(null);
      const { data } = await adminApi.deleteSfxVariant(entry.id, entry.variant);
      const bust = Date.now();
      setCacheBustByKey((prev) => {
        const next = { ...prev };
        next[entry.assetKey] = bust;
        for (const r of data.renamed) {
          next[r.to] = bust;
        }
        return next;
      });
      await reloadCatalog();
      const renamedText =
        data.renamed.length > 0
          ? `; сдвиг: ${data.renamed.map((r) => `${r.from}→${r.to}`).join(", ")}`
          : "";
      setBanner({
        severity: "success",
        text: `Удалён ${entry.assetKey} (variants=${data.variants})${renamedText}`,
      });
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })
          ?.response?.data?.message || "Ошибка удаления";
      const text = Array.isArray(message) ? message.join(", ") : String(message);
      setBanner({
        severity: "error",
        text: `${entry.assetKey}: ${text}`,
      });
    } finally {
      setUploadingKey(null);
    }
  };

  const onAddFragment = async (entry: SfxCatalogEntry) => {
    if (entry.variant !== entry.variantCount) return;
    try {
      setUploadingKey(entry.assetKey);
      setBanner(null);
      const { data } = await adminApi.duplicateLastSfxVariant(entry.id);
      const bust = Date.now();
      setCacheBustByKey((prev) => ({
        ...prev,
        [data.toAssetKey]: bust,
        [data.fromAssetKey]: bust,
      }));
      await reloadCatalog();
      setBanner({
        severity: "success",
        text: `Добавлен ${data.toAssetKey} (копия ${data.fromAssetKey}, variants=${data.variants}). Можно заменить.`,
      });
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })
          ?.response?.data?.message || "Ошибка добавления";
      const text = Array.isArray(message) ? message.join(", ") : String(message);
      setBanner({
        severity: "error",
        text: `${entry.id}: ${text}`,
      });
    } finally {
      setUploadingKey(null);
    }
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ color: "rgba(184, 134, 11, 1)", mb: 1 }}>
        Звуковые эффекты
      </Typography>
      <Typography
        variant="body2"
        sx={{ color: "rgba(255,255,255,0.65)", mb: 2 }}
      >
        Каталог из `catalog.json` ({ALL_SFX_IDS.length} id, {catalog.length}{" "}
        файлов). Upload открывает нарезку: у каждого фрагмента своя громкость
        (% от исходника); пишутся от выбранного слота подряд (`sfx_foo`,
        `sfx_foo_2`…). «Добавить фрагмент» у последнего слота — копия
        последнего файла (без модалки), затем его можно заменить. Удалить
        (если вариантов больше одного) сдвигает следующие файлы вниз. В игре
        `play(base)` берёт случайный вариант.
      </Typography>

      <input
        ref={fileInputRef}
        type="file"
        accept=".ogg,.wav,.mp3,audio/ogg,audio/wav,audio/mpeg,audio/mp3"
        hidden
        onChange={(e) => onFileSelected(e.target.files?.[0])}
      />

      {catalogError ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {catalogError}
        </Alert>
      ) : null}

      {banner ? (
        <Alert
          severity={banner.severity}
          sx={{ mb: 2 }}
          onClose={() => setBanner(null)}
        >
          {banner.text}
        </Alert>
      ) : null}

      <Paper
        sx={{
          p: 2,
          mb: 2,
          backgroundColor: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(184, 134, 11, 0.25)",
        }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems={{ sm: "center" }}
        >
          <TextField
            size="small"
            label="Поиск"
            placeholder="sfx_hit_miss / промах"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{
              minWidth: 220,
              flex: 1,
              "& .MuiInputBase-root": { color: "#fff" },
              "& .MuiInputLabel-root": { color: "rgba(255,255,255,0.6)" },
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: "rgba(184, 134, 11, 0.35)",
              },
            }}
          />
          <Box sx={{ minWidth: 200, flex: 1 }}>
            <Typography
              variant="caption"
              sx={{ color: "rgba(255,255,255,0.6)" }}
            >
              Громкость: {Math.round(volume * 100)}%
            </Typography>
            <Slider
              value={volume}
              min={0}
              max={1}
              step={0.05}
              onChange={(_, v) => setVolume(v as number)}
              sx={{ color: "rgba(184, 134, 11, 0.9)" }}
            />
          </Box>
          {lastPlayed ? (
            <Chip
              label={`▶ ${lastPlayed}`}
              sx={{
                color: "#fff",
                borderColor: "rgba(184, 134, 11, 0.5)",
              }}
              variant="outlined"
            />
          ) : null}
        </Stack>
        <Typography
          variant="caption"
          sx={{ color: "rgba(255,255,255,0.45)", mt: 1, display: "block" }}
        >
          Показано {filtered.length} из {catalog.length} файлов
          {sfxCatalog == null ? " · загрузка каталога…" : ""}
        </Typography>
      </Paper>

      <Stack spacing={2}>
        {grouped.map(([cat, idGroups]) => (
          <Paper
            key={cat}
            sx={{
              p: 2,
              backgroundColor: "rgba(0,0,0,0.2)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <Typography
              variant="subtitle1"
              sx={{ color: "rgba(184, 134, 11, 0.95)", mb: 1.5 }}
            >
              {categoryLabel(cat)}{" "}
              <Typography
                component="span"
                variant="caption"
                sx={{ color: "rgba(255,255,255,0.45)" }}
              >
                ({idGroups.reduce((n, g) => n + g.length, 0)})
              </Typography>
            </Typography>
            <Stack spacing={1.25}>
              {idGroups.map((group) => (
                <Box key={group[0]!.id} sx={{ width: "100%" }}>
                  <Stack
                    direction={{ xs: "column", md: "row" }}
                    spacing={1}
                    alignItems={{ md: "flex-start" }}
                    sx={{ mb: 1 }}
                  >
                    <TextField
                      size="small"
                      label="Описание"
                      fullWidth
                      multiline
                      minRows={1}
                      maxRows={3}
                      value={draftById[group[0]!.id] ?? ""}
                      onChange={(e) =>
                        setDraftById((prev) => ({
                          ...prev,
                          [group[0]!.id]: e.target.value,
                        }))
                      }
                      sx={{
                        flex: 1,
                        "& .MuiInputBase-root": { color: "#fff" },
                        "& .MuiInputLabel-root": {
                          color: "rgba(255,255,255,0.6)",
                        },
                        "& .MuiOutlinedInput-notchedOutline": {
                          borderColor: "rgba(184, 134, 11, 0.35)",
                        },
                      }}
                    />
                    <Button
                      variant="outlined"
                      size="small"
                      disabled={
                        savingId === group[0]!.id ||
                        (draftById[group[0]!.id] ?? "") ===
                          (metaById[group[0]!.id] ?? "")
                      }
                      onClick={() => void saveDescription(group[0]!.id)}
                      sx={{
                        textTransform: "none",
                        minWidth: 110,
                        color: "rgba(255,255,255,0.85)",
                        borderColor: "rgba(184, 134, 11, 0.45)",
                      }}
                    >
                      {savingId === group[0]!.id ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : (
                        "Сохранить"
                      )}
                    </Button>
                  </Stack>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
                      gap: 1.25,
                      width: "100%",
                    }}
                  >
                  {group.map((entry) => {
                    const { assetKey } = entry;
                    const busy = uploadingKey === assetKey;
                    const isLastVariant = entry.variant === entry.variantCount;
                    return (
                      <Stack
                        key={assetKey}
                        direction="row"
                        spacing={1}
                        alignItems="flex-start"
                      >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Button
                            variant="outlined"
                            size="small"
                            fullWidth
                            onClick={() => play(assetKey)}
                            disabled={busy}
                            sx={{
                              justifyContent: "flex-start",
                              textTransform: "none",
                              color:
                                lastPlayed === assetKey
                                  ? "rgba(184, 134, 11, 1)"
                                  : "rgba(255,255,255,0.85)",
                              borderColor:
                                errorByKey[assetKey]
                                  ? "rgba(220, 80, 80, 0.7)"
                                  : lastPlayed === assetKey
                                    ? "rgba(184, 134, 11, 0.7)"
                                    : "rgba(255,255,255,0.2)",
                              "&:hover": {
                                borderColor: "rgba(184, 134, 11, 0.8)",
                                backgroundColor: "rgba(184, 134, 11, 0.08)",
                              },
                            }}
                            title={
                              errorByKey[assetKey] ??
                              sfxAssetUrl(assetKey, cacheBustByKey[assetKey])
                            }
                          >
                            ▶ {entryLabel(entry)}
                          </Button>
                          {entry.variantCount > 1 ? (
                            <Typography
                              variant="caption"
                              sx={{
                                color: "rgba(255,255,255,0.45)",
                                display: "block",
                                mt: 0.4,
                                pl: 0.5,
                              }}
                            >
                              вариант {entry.variant}/{entry.variantCount}
                            </Typography>
                          ) : null}
                        </Box>
                        <Stack
                          direction="row"
                          spacing={0.75}
                          sx={{
                            mt: 0.15,
                            flexWrap: "wrap",
                            justifyContent: "flex-end",
                          }}
                        >
                          <Button
                            variant="contained"
                            size="small"
                            disabled={busy || uploadingKey !== null}
                            onClick={() => openUploadPicker(assetKey)}
                            sx={{
                              minWidth: 96,
                              textTransform: "none",
                              backgroundColor: "rgba(184, 134, 11, 0.85)",
                              "&:hover": {
                                backgroundColor: "rgba(184, 134, 11, 1)",
                              },
                            }}
                          >
                            {busy ? (
                              <CircularProgress size={16} color="inherit" />
                            ) : (
                              "Заменить"
                            )}
                          </Button>
                          {isLastVariant ? (
                            <Button
                              variant="outlined"
                              size="small"
                              disabled={busy || uploadingKey !== null}
                              onClick={() => void onAddFragment(entry)}
                              title="Скопировать последний вариант в новый слот (без модалки нарезки)"
                              sx={{
                                minWidth: 140,
                                textTransform: "none",
                                borderColor: "rgba(184, 134, 11, 0.55)",
                                color: "rgba(220, 200, 140, 0.95)",
                                "&:hover": {
                                  borderColor: "rgba(184, 134, 11, 0.9)",
                                  backgroundColor: "rgba(184, 134, 11, 0.1)",
                                },
                              }}
                            >
                              Добавить фрагмент
                            </Button>
                          ) : null}
                          {entry.variantCount > 1 ? (
                            <Button
                              variant="outlined"
                              size="small"
                              color="error"
                              disabled={busy || uploadingKey !== null}
                              onClick={() => void onDeleteVariant(entry)}
                              sx={{
                                minWidth: 88,
                                textTransform: "none",
                                borderColor: "rgba(220, 80, 80, 0.55)",
                                color: "rgba(255, 160, 160, 0.95)",
                                "&:hover": {
                                  borderColor: "rgba(220, 80, 80, 0.9)",
                                  backgroundColor: "rgba(220, 80, 80, 0.12)",
                                },
                              }}
                            >
                              Удалить
                            </Button>
                          ) : null}
                        </Stack>
                      </Stack>
                    );
                  })}
                  </Box>
                </Box>
              ))}
            </Stack>
          </Paper>
        ))}
        {grouped.length === 0 ? (
          <Typography sx={{ color: "rgba(255,255,255,0.5)" }}>
            Ничего не найдено
          </Typography>
        ) : null}
      </Stack>

      <AdminSfxCutDialog
        open={cutOpen}
        file={cutFile}
        baseId={cutBaseId}
        startVariant={cutStartVariant}
        busy={uploadingKey !== null}
        onClose={closeCut}
        onConfirm={(segments) => void onConfirmCut(segments)}
      />
    </Box>
  );
}
