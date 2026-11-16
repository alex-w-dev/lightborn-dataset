import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Slider,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import { useEffect, useMemo, useRef, useState } from "react";

export type SfxCutSegment = {
  startSec: number;
  endSec: number;
  /** Множитель громкости относительно исходника (1 = 100%). */
  volume: number;
};

type Props = {
  open: boolean;
  file: File | null;
  /** Слот, с которого пишем фрагменты (1 = base). */
  startVariant: number;
  baseId: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (segments: SfxCutSegment[]) => void;
};

function formatSec(v: number): string {
  if (!Number.isFinite(v)) return "0.00";
  return v.toFixed(2);
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
  segments: SfxCutSegment[],
  duration: number,
  selectedIndex: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, w, h);

  if (duration > 0) {
    // Сначала остальные, выбранный — сверху (видна размеченная зона).
    const order = [
      ...segments.map((_, i) => i).filter((i) => i !== selectedIndex),
      ...(selectedIndex >= 0 && selectedIndex < segments.length
        ? [selectedIndex]
        : []),
    ];
    for (const i of order) {
      const seg = segments[i]!;
      const x0 = (seg.startSec / duration) * w;
      const x1 = (seg.endSec / duration) * w;
      ctx.fillStyle =
        i === selectedIndex
          ? "rgba(184, 134, 11, 0.35)"
          : "rgba(255,255,255,0.08)";
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    }
  }

  ctx.strokeStyle = "rgba(184, 134, 11, 0.9)";
  ctx.beginPath();
  const mid = h / 2;
  for (let x = 0; x < w; x++) {
    const idx = Math.floor((x / w) * peaks.length);
    const amp = peaks[idx] ?? 0;
    const y = amp * (h * 0.45);
    if (x === 0) ctx.moveTo(x, mid - y);
    else ctx.lineTo(x, mid - y);
  }
  for (let x = w - 1; x >= 0; x--) {
    const idx = Math.floor((x / w) * peaks.length);
    const amp = peaks[idx] ?? 0;
    const y = amp * (h * 0.45);
    ctx.lineTo(x, mid + y);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(184, 134, 11, 0.25)";
  ctx.fill();
  ctx.stroke();
}

function buildPeaks(buffer: AudioBuffer, buckets = 600): Float32Array {
  const channel = buffer.getChannelData(0);
  const peaks = new Float32Array(buckets);
  const block = Math.max(1, Math.floor(channel.length / buckets));
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * block;
    const end = Math.min(channel.length, start + block);
    for (let j = start; j < end; j++) {
      const v = Math.abs(channel[j] ?? 0);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  return peaks;
}

export default function AdminSfxCutDialog({
  open,
  file,
  startVariant,
  baseId,
  busy = false,
  onClose,
  onConfirm,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const previewCtxRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [segments, setSegments] = useState<SfxCutSegment[]>([]);
  const [selected, setSelected] = useState(0);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const previewGainRef = useRef<GainNode | null>(null);

  const stopPreview = () => {
    try {
      previewSourceRef.current?.stop();
    } catch {
      // already stopped
    }
    previewSourceRef.current = null;
    setPlayingIndex(null);
  };

  useEffect(() => {
    if (!open || !file) {
      stopPreview();
      audioBufferRef.current = null;
      setDuration(0);
      setPeaks(null);
      setSegments([]);
      setSelected(0);
      setDecodeError(null);
      return;
    }

    let cancelled = false;
    setDecoding(true);
    setDecodeError(null);
    stopPreview();

    void (async () => {
      try {
        const ctx = new AudioContext();
        try {
          const data = await file.arrayBuffer();
          const audio = await ctx.decodeAudioData(data.slice(0));
          if (cancelled) return;
          const dur = audio.duration || 0;
          audioBufferRef.current = audio;
          setDuration(dur);
          setPeaks(buildPeaks(audio));
          setSegments([{ startSec: 0, endSec: dur, volume: 1 }]);
          setSelected(0);
        } finally {
          await ctx.close().catch(() => undefined);
        }
      } catch (err) {
        if (!cancelled) {
          audioBufferRef.current = null;
          setDecodeError(
            err instanceof Error ? err.message : "Не удалось декодировать аудио",
          );
        }
      } finally {
        if (!cancelled) setDecoding(false);
      }
    })();

    return () => {
      cancelled = true;
      stopPreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/file
  }, [open, file]);

  useEffect(() => {
    return () => {
      stopPreview();
      void previewCtxRef.current?.close().catch(() => undefined);
      previewCtxRef.current = null;
      previewGainRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || duration <= 0) return;
    drawWaveform(canvas, peaks, segments, duration, selected);
  }, [peaks, segments, duration, selected]);

  const targetSlots = useMemo(() => {
    return segments.map((_, i) => {
      const variant = startVariant + i;
      return variant <= 1 ? baseId : `${baseId}_${variant}`;
    });
  }, [segments, startVariant, baseId]);

  const canConfirm =
    !busy &&
    !decoding &&
    !decodeError &&
    segments.length > 0 &&
    segments.every((s) => s.endSec > s.startSec);

  const updateSegment = (index: number, patch: Partial<SfxCutSegment>) => {
    setSegments((prev) =>
      prev.map((seg, i) => {
        if (i !== index) return seg;
        const next = { ...seg, ...patch };
        next.startSec = Math.max(0, Math.min(duration, next.startSec));
        next.endSec = Math.max(0, Math.min(duration, next.endSec));
        if (next.endSec <= next.startSec) {
          next.endSec = Math.min(duration, next.startSec + 0.05);
        }
        if (next.volume !== undefined) {
          next.volume = Math.max(0.05, Math.min(1.5, next.volume));
        }
        return next;
      }),
    );
    if (
      patch.volume !== undefined &&
      playingIndex === index &&
      previewGainRef.current
    ) {
      previewGainRef.current.gain.value = Math.max(
        0.05,
        Math.min(1.5, patch.volume),
      );
    }
  };

  const addSegment = () => {
    const last = segments[segments.length - 1];
    const len = Math.max(0.2, duration * 0.1);
    // Новый в конец массива (слоты по порядку), в UI — сверху (column-reverse).
    const start = last
      ? Math.min(duration, last.endSec)
      : 0;
    const end = Math.min(duration, start + len);
    setSegments((prev) => [
      ...prev,
      {
        startSec: start,
        endSec: end || duration,
        volume: last?.volume ?? 1,
      },
    ]);
    setSelected(segments.length);
  };

  const removeSegment = (index: number) => {
    if (segments.length <= 1) return;
    if (playingIndex === index) stopPreview();
    setSegments((prev) => prev.filter((_, i) => i !== index));
    setSelected((prev) => Math.max(0, Math.min(prev, segments.length - 2)));
  };

  const playSegment = async (index: number) => {
    const buffer = audioBufferRef.current;
    const seg = segments[index];
    if (!buffer || !seg || seg.endSec <= seg.startSec) return;

    if (playingIndex === index) {
      stopPreview();
      return;
    }

    stopPreview();
    let ctx = previewCtxRef.current;
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContext();
      previewCtxRef.current = ctx;
    }
    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => undefined);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    let gain = previewGainRef.current;
    if (!gain || gain.context !== ctx) {
      gain = ctx.createGain();
      gain.connect(ctx.destination);
      previewGainRef.current = gain;
    }
    const segVolume = Math.max(0.05, Math.min(1.5, seg.volume ?? 1));
    gain.gain.value = segVolume;
    source.connect(gain);
    const offset = Math.max(0, Math.min(buffer.duration, seg.startSec));
    const playDur = Math.max(
      0.01,
      Math.min(buffer.duration - offset, seg.endSec - seg.startSec),
    );
    source.onended = () => {
      if (previewSourceRef.current === source) {
        previewSourceRef.current = null;
        setPlayingIndex(null);
      }
    };
    previewSourceRef.current = source;
    setPlayingIndex(index);
    source.start(0, offset, playDur);
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "rgba(20,20,24,0.98)",
          border: "1px solid rgba(184, 134, 11, 0.35)",
        },
      }}
    >
      <DialogTitle sx={{ color: "rgba(184, 134, 11, 1)" }}>
        Нарезка SFX → {baseId} с варианта {startVariant}
      </DialogTitle>
      <DialogContent>
        <Typography
          variant="body2"
          sx={{ color: "rgba(255,255,255,0.65)", mb: 1.5 }}
        >
          Фрагменты пишутся подряд: {targetSlots.join(", ") || "—"}. По умолчанию
          один фрагмент на всю длину. У каждого фрагмента своя громкость (% от
          исходника) — применяется при загрузке и в превью.
        </Typography>

        {decoding ? (
          <Typography sx={{ color: "rgba(255,255,255,0.6)" }}>
            Декодирование…
          </Typography>
        ) : null}
        {decodeError ? (
          <Typography sx={{ color: "rgba(220,80,80,0.95)" }}>
            {decodeError}
          </Typography>
        ) : null}

        <Box
          sx={{
            width: "100%",
            height: 120,
            mb: 2,
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 1,
            overflow: "hidden",
          }}
        >
          <canvas
            ref={canvasRef}
            width={900}
            height={120}
            style={{ width: "100%", height: "100%", display: "block" }}
          />
        </Box>

        <Button
          startIcon={<AddIcon />}
          onClick={addSegment}
          disabled={busy || decoding || !!decodeError || duration <= 0}
          sx={{ mb: 1.5, textTransform: "none", color: "rgba(184, 134, 11, 1)" }}
        >
          Добавить фрагмент
        </Button>

        <Stack spacing={1.5} sx={{ flexDirection: "column-reverse" }}>
          {segments.map((seg, index) => (
            <Box
              key={index}
              onClick={() => setSelected(index)}
              sx={{
                p: 1.25,
                borderRadius: 1,
                border:
                  selected === index
                    ? "1px solid rgba(184, 134, 11, 0.7)"
                    : "1px solid rgba(255,255,255,0.12)",
                backgroundColor:
                  selected === index
                    ? "rgba(184, 134, 11, 0.08)"
                    : "rgba(0,0,0,0.2)",
                cursor: "pointer",
              }}
            >
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ mb: 0.5 }}
              >
                <Typography
                  variant="subtitle2"
                  sx={{ color: "rgba(255,255,255,0.9)" }}
                >
                  Фрагмент {index + 1} → {targetSlots[index]} (
                  {formatSec(seg.startSec)}–{formatSec(seg.endSec)} с,{" "}
                  {Math.round((seg.volume ?? 1) * 100)}%)
                </Typography>
                <Stack direction="row" spacing={0.25}>
                  <IconButton
                    size="small"
                    disabled={busy || decoding || !!decodeError}
                    title={
                      playingIndex === index
                        ? "Остановить"
                        : "Проиграть фрагмент"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      void playSegment(index);
                    }}
                    sx={{
                      color:
                        playingIndex === index
                          ? "rgba(184, 134, 11, 1)"
                          : "rgba(255,255,255,0.7)",
                    }}
                  >
                    {playingIndex === index ? (
                      <StopIcon fontSize="small" />
                    ) : (
                      <PlayArrowIcon fontSize="small" />
                    )}
                  </IconButton>
                  <IconButton
                    size="small"
                    disabled={segments.length <= 1 || busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSegment(index);
                    }}
                    sx={{ color: "rgba(255,255,255,0.7)" }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Stack>
              <Typography
                variant="caption"
                sx={{ color: "rgba(255,255,255,0.5)" }}
              >
                Старт
              </Typography>
              <Slider
                value={seg.startSec}
                min={0}
                max={duration || 1}
                step={0.01}
                disabled={busy || duration <= 0}
                onChange={(_, v) =>
                  updateSegment(index, { startSec: v as number })
                }
                sx={{ color: "rgba(184, 134, 11, 0.9)" }}
              />
              <Typography
                variant="caption"
                sx={{ color: "rgba(255,255,255,0.5)" }}
              >
                Конец
              </Typography>
              <Slider
                value={seg.endSec}
                min={0}
                max={duration || 1}
                step={0.01}
                disabled={busy || duration <= 0}
                onChange={(_, v) =>
                  updateSegment(index, { endSec: v as number })
                }
                sx={{ color: "rgba(184, 134, 11, 0.9)" }}
              />
              <Typography
                variant="caption"
                sx={{ color: "rgba(255,255,255,0.5)" }}
              >
                Громкость: {Math.round((seg.volume ?? 1) * 100)}% от исходника
              </Typography>
              <Slider
                value={seg.volume ?? 1}
                min={0.05}
                max={1.5}
                step={0.05}
                disabled={busy || duration <= 0}
                onChange={(_, v) =>
                  updateSegment(index, { volume: v as number })
                }
                valueLabelDisplay="auto"
                valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
                sx={{ color: "rgba(184, 134, 11, 0.9)" }}
              />
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          onClick={onClose}
          disabled={busy}
          sx={{ textTransform: "none", color: "rgba(255,255,255,0.7)" }}
        >
          Отмена
        </Button>
        <Button
          variant="contained"
          disabled={!canConfirm}
          onClick={() => {
            stopPreview();
            onConfirm(segments);
          }}
          sx={{
            textTransform: "none",
            backgroundColor: "rgba(184, 134, 11, 0.85)",
            "&:hover": { backgroundColor: "rgba(184, 134, 11, 1)" },
          }}
        >
          {busy ? "Загрузка…" : `Загрузить ${segments.length} фрагм.`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
