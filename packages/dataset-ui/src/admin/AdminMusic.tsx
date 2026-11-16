import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Slider,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { datasetAdminApi as adminApi } from "./datasetAdminApi";

type MusicWave = "peace" | "battle" | "lobby";

type MusicTrack = {
  id: string;
  url: string;
};

type MusicMetaRow = {
  id: string;
  wave: MusicWave;
  description: string;
};

function metaKey(wave: MusicWave, id: string): string {
  return `${wave}\0${id}`;
}

const WAVE_LABELS: Record<MusicWave, string> = {
  peace: "Мирная (peace)",
  battle: "Боевая (battle)",
  lobby: "Лобби (lobby)",
};

export default function AdminMusic() {
  const [searchParams] = useSearchParams();
  const initialWave = searchParams.get("wave");
  const [wave, setWave] = useState<MusicWave>(
    initialWave === "battle" || initialWave === "lobby" || initialWave === "peace"
      ? initialWave
      : "peace",
  );
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [metaByKey, setMetaByKey] = useState<Record<string, string>>({});
  const [draftByKey, setDraftByKey] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.7);
  const [lastPlayed, setLastPlayed] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    severity: "success" | "error";
    text: string;
  } | null>(null);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadTracks = useCallback(async (w: MusicWave) => {
    setLoading(true);
    setBanner(null);
    try {
      const [{ data }, metaRes] = await Promise.all([
        adminApi.getMusicWave(w),
        adminApi.getDatasetRaw<MusicMetaRow[]>("music"),
      ]);
      setTracks(data.tracks ?? []);
      const map: Record<string, string> = {};
      for (const row of Array.isArray(metaRes.data) ? metaRes.data : []) {
        const id = String(row.id ?? "").trim();
        const rowWave = String(row.wave ?? "").trim() as MusicWave;
        if (!id || !rowWave) continue;
        map[metaKey(rowWave, id)] = String(row.description ?? "");
      }
      setMetaByKey(map);
      setDraftByKey(map);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })
          ?.response?.data?.message || "Не удалось загрузить список";
      const text = Array.isArray(message) ? message.join(", ") : String(message);
      setBanner({ severity: "error", text });
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTracks(wave);
  }, [wave, loadTracks]);

  const visibleTracks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((track) => {
      const description = (metaByKey[metaKey(wave, track.id)] ?? "").toLowerCase();
      return (
        track.id.toLowerCase().includes(q) || description.includes(q)
      );
    });
  }, [tracks, query, metaByKey, wave]);

  const saveDescription = async (trackId: string) => {
    const key = metaKey(wave, trackId);
    const description = draftByKey[key] ?? "";
    try {
      setSavingKey(key);
      setBanner(null);
      const { data: raw } = await adminApi.getDatasetRaw<MusicMetaRow[]>("music");
      const rows = Array.isArray(raw) ? [...raw] : [];
      const idx = rows.findIndex((r) => r.wave === wave && r.id === trackId);
      if (idx >= 0) {
        rows[idx] = { ...rows[idx]!, description };
      } else {
        rows.push({ id: trackId, wave, description });
      }
      rows.sort(
        (a, b) =>
          a.wave.localeCompare(b.wave) || a.id.localeCompare(b.id, "en"),
      );
      await adminApi.putDatasetRaw("music", rows);
      setMetaByKey((prev) => ({ ...prev, [key]: description }));
      setBanner({
        severity: "success",
        text: `Описание сохранено: ${wave}/${trackId}`,
      });
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })
          ?.response?.data?.message || "Не удалось сохранить описание";
      const text = Array.isArray(message) ? message.join(", ") : String(message);
      setBanner({ severity: "error", text });
    } finally {
      setSavingKey(null);
    }
  };

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const play = (track: MusicTrack) => {
    audioRef.current?.pause();
    const audio = new Audio(track.url);
    audio.volume = Math.max(0, Math.min(1, volumeRef.current));
    audioRef.current = audio;
    setLastPlayed(track.id);
    void audio.play().catch((err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Не удалось воспроизвести";
      setBanner({ severity: "error", text: `${track.id}: ${message}` });
    });
  };

  const onFileSelected = async (file: File | undefined) => {
    if (!file) return;
    try {
      setUploading(true);
      setBanner(null);
      const { data } = await adminApi.uploadMusic(wave, file);
      const via =
        data.converted && data.format
          ? ` ← ${file.name} (${data.format}→ogg)`
          : ` ← ${file.name}`;
      setBanner({
        severity: "success",
        text: `Загружено: ${data.id}.ogg${via}`,
      });
      await loadTracks(wave);
      if (data.url) {
        play({ id: data.id, url: data.url });
      }
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })
          ?.response?.data?.message || "Ошибка загрузки";
      const text = Array.isArray(message) ? message.join(", ") : String(message);
      setBanner({ severity: "error", text });
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (track: MusicTrack) => {
    if (!window.confirm(`Удалить ${track.id}?`)) return;
    try {
      setDeletingId(track.id);
      setBanner(null);
      if (lastPlayed === track.id) {
        audioRef.current?.pause();
        setLastPlayed(null);
      }
      await adminApi.deleteMusic(wave, track.id);
      setBanner({ severity: "success", text: `Удалено: ${track.id}` });
      await loadTracks(wave);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })
          ?.response?.data?.message || "Ошибка удаления";
      const text = Array.isArray(message) ? message.join(", ") : String(message);
      setBanner({ severity: "error", text });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ color: "rgba(184, 134, 11, 1)", mb: 1 }}>
        Фоновая музыка
      </Typography>
      <Typography
        variant="body2"
        sx={{ color: "rgba(255,255,255,0.65)", mb: 2 }}
      >
        Волны peace / battle / lobby в S3 (music/{"{wave}"}/{"{id}"}/original.ogg).
        Upload: .ogg / .wav / .mp3 → ffmpeg → ogg; имя файла сохраняется (без
        переименования; повторная загрузка того же имени перезаписывает). Клиент
        играет случайный трек волны; lobby сам ставит следующий (пауза 1 мин
        между треками, если их несколько).
      </Typography>

      <input
        ref={fileInputRef}
        type="file"
        accept=".ogg,.wav,.mp3,audio/ogg,audio/wav,audio/mpeg,audio/mp3"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void onFileSelected(f);
        }}
      />

      {banner ? (
        <Alert
          severity={banner.severity}
          sx={{ mb: 2 }}
          onClose={() => setBanner(null)}
        >
          {banner.text}
        </Alert>
      ) : null}

      <Tabs
        value={wave}
        onChange={(_, v: MusicWave) => setWave(v)}
        sx={{
          mb: 2,
          borderBottom: 1,
          borderColor: "rgba(184, 134, 11, 0.3)",
          "& .MuiTab-root": { color: "rgba(255,255,255,0.7)" },
          "& .Mui-selected": { color: "rgba(184, 134, 11, 1) !important" },
          "& .MuiTabs-indicator": {
            backgroundColor: "rgba(184, 134, 11, 0.8)",
          },
        }}
      >
        <Tab value="peace" label={WAVE_LABELS.peace} />
        <Tab value="battle" label={WAVE_LABELS.battle} />
        <Tab value="lobby" label={WAVE_LABELS.lobby} />
      </Tabs>

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
          <Button
            variant="contained"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            sx={{
              textTransform: "none",
              backgroundColor: "rgba(184, 134, 11, 0.85)",
              "&:hover": { backgroundColor: "rgba(184, 134, 11, 1)" },
            }}
          >
            {uploading ? (
              <CircularProgress size={18} color="inherit" />
            ) : (
              "Загрузить трек"
            )}
          </Button>
          <TextField
            size="small"
            label="Поиск"
            placeholder="id / описание"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{
              minWidth: 180,
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
              Громкость превью: {Math.round(volume * 100)}%
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
          <Button
            variant="outlined"
            size="small"
            disabled={loading}
            onClick={() => void loadTracks(wave)}
            sx={{
              textTransform: "none",
              color: "rgba(255,255,255,0.8)",
              borderColor: "rgba(255,255,255,0.25)",
            }}
          >
            Обновить
          </Button>
        </Stack>
        <Typography
          variant="caption"
          sx={{ color: "rgba(255,255,255,0.45)", mt: 1, display: "block" }}
        >
          {WAVE_LABELS[wave]}: {visibleTracks.length}/{tracks.length} трек(ов)
        </Typography>
      </Paper>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress sx={{ color: "rgba(184, 134, 11, 0.9)" }} />
        </Box>
      ) : (
        <Stack spacing={1.25}>
          {visibleTracks.map((track) => {
            const busy = deletingId === track.id;
            const key = metaKey(wave, track.id);
            return (
              <Paper
                key={track.id}
                sx={{
                  p: 1.5,
                  backgroundColor: "rgba(0,0,0,0.2)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <Stack spacing={1}>
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    flexWrap="wrap"
                  >
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => play(track)}
                      disabled={busy}
                      sx={{
                        textTransform: "none",
                        color:
                          lastPlayed === track.id
                            ? "rgba(184, 134, 11, 1)"
                            : "rgba(255,255,255,0.85)",
                        borderColor:
                          lastPlayed === track.id
                            ? "rgba(184, 134, 11, 0.7)"
                            : "rgba(255,255,255,0.2)",
                        flex: 1,
                        minWidth: 180,
                        justifyContent: "flex-start",
                      }}
                      title={track.url}
                    >
                      ▶ {track.id}
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      color="error"
                      disabled={busy || uploading}
                      onClick={() => void onDelete(track)}
                      sx={{ textTransform: "none", minWidth: 96 }}
                    >
                      {busy ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : (
                        "Удалить"
                      )}
                    </Button>
                  </Stack>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1}
                    alignItems={{ sm: "flex-start" }}
                  >
                    <TextField
                      size="small"
                      label="Описание"
                      fullWidth
                      multiline
                      minRows={1}
                      maxRows={3}
                      value={draftByKey[key] ?? ""}
                      onChange={(e) =>
                        setDraftByKey((prev) => ({
                          ...prev,
                          [key]: e.target.value,
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
                        savingKey === key ||
                        (draftByKey[key] ?? "") === (metaByKey[key] ?? "")
                      }
                      onClick={() => void saveDescription(track.id)}
                      sx={{
                        textTransform: "none",
                        minWidth: 110,
                        color: "rgba(255,255,255,0.85)",
                        borderColor: "rgba(184, 134, 11, 0.45)",
                      }}
                    >
                      {savingKey === key ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : (
                        "Сохранить"
                      )}
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
          {visibleTracks.length === 0 ? (
            <Typography sx={{ color: "rgba(255,255,255,0.5)" }}>
              {tracks.length === 0
                ? "Пусто — загрузите первый трек"
                : "Ничего не найдено"}
            </Typography>
          ) : null}
        </Stack>
      )}
    </Box>
  );
}
