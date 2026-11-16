import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import {
  hitTestSquareCropCorner,
  maxCenteredSquare,
  moveSquareCropRect,
  resizeSquareCropFromCorner,
  type SquareCropCorner,
  type SquareCropDragMode,
  type SquareCropRect,
} from "@l-fight/dataset";

const CROP_VIEW_MAX = 640;
const CROP_HANDLE = 12;

const CROP_CORNER_CURSOR: Record<SquareCropCorner, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
};

async function cropImageToSquareBase64(
  imageSrc: string,
  crop: SquareCropRect,
): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось загрузить изображение"));
    img.src = imageSrc;
  });
  const canvas = document.createElement("canvas");
  canvas.width = crop.size;
  canvas.height = crop.size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas недоступен");
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.size,
    crop.size,
    0,
    0,
    crop.size,
    crop.size,
  );
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

export default function SquareCropDialog({
  open,
  imageSrc,
  applying,
  error,
  onClose,
  onApply,
}: {
  open: boolean;
  imageSrc: string;
  applying: boolean;
  error?: string;
  onClose: () => void;
  onApply: (imageBase64: string) => void;
}) {
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [crop, setCrop] = useState<SquareCropRect>({ x: 0, y: 0, size: 0 });
  const [hoverCorner, setHoverCorner] = useState<SquareCropCorner | null>(null);
  const [dragMode, setDragMode] = useState<SquareCropDragMode | null>(null);
  const dragRef = useRef<{
    mode: SquareCropDragMode;
    startX: number;
    startY: number;
    origin: SquareCropRect;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !imageSrc) return;
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      setNaturalSize({ width, height });
      setCrop(maxCenteredSquare(width, height));
    };
    image.src = imageSrc;
  }, [open, imageSrc]);

  const scale =
    naturalSize.width > 0
      ? Math.min(
          1,
          CROP_VIEW_MAX / Math.max(naturalSize.width, naturalSize.height),
        )
      : 1;
  const displayWidth = Math.round(naturalSize.width * scale);
  const displayHeight = Math.round(naturalSize.height * scale);

  const toImageCoords = (clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!naturalSize.width) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const pos = toImageCoords(event.clientX, event.clientY);
    const corner = hitTestSquareCropCorner(
      pos,
      crop,
      CROP_HANDLE / Math.max(scale, 0.001),
    );
    const mode: SquareCropDragMode = corner ?? "move";
    dragRef.current = {
      mode,
      startX: pos.x,
      startY: pos.y,
      origin: crop,
    };
    setDragMode(mode);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pos = toImageCoords(event.clientX, event.clientY);
    const drag = dragRef.current;
    if (!drag) {
      setHoverCorner(
        hitTestSquareCropCorner(
          pos,
          crop,
          CROP_HANDLE / Math.max(scale, 0.001),
        ),
      );
      return;
    }
    const dx = pos.x - drag.startX;
    const dy = pos.y - drag.startY;
    if (drag.mode === "move") {
      setCrop(
        moveSquareCropRect(
          drag.origin,
          dx,
          dy,
          naturalSize.width,
          naturalSize.height,
        ),
      );
      return;
    }
    setCrop(
      resizeSquareCropFromCorner(
        drag.origin,
        drag.mode,
        dx,
        dy,
        naturalSize.width,
        naturalSize.height,
      ),
    );
  };

  const onPointerUp = () => {
    dragRef.current = null;
    setDragMode(null);
  };

  const activeCorner: SquareCropCorner | null =
    dragMode && dragMode !== "move" ? dragMode : hoverCorner;
  const cropCursor = activeCorner
    ? CROP_CORNER_CURSOR[activeCorner]
    : "move";

  const handleApply = async () => {
    if (!imageSrc || crop.size < 1) return;
    const base64 = await cropImageToSquareBase64(imageSrc, crop);
    if (!base64) return;
    onApply(base64);
  };

  return (
    <Dialog open={open} onClose={applying ? undefined : onClose} maxWidth={false}>
      <DialogTitle>Кроп иконки (квадрат)</DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="error" sx={{ mb: 1 }}>
            {error}
          </Alert>
        ) : null}
        <Typography variant="body2" sx={{ mb: 1, opacity: 0.8 }}>
          Перетащите рамку; любой угол — изменить размер (квадрат). Сторона
          кропа: {Math.round(crop.size)}px
          {crop.size < 512 ? " → extras-апскейл до 512" : " → resize до 512"}
        </Typography>
        <Box
          ref={containerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => {
            if (!dragRef.current) setHoverCorner(null);
          }}
          sx={{
            position: "relative",
            width: displayWidth || CROP_VIEW_MAX,
            height: displayHeight || CROP_VIEW_MAX,
            border: "1px solid rgba(255,255,255,0.25)",
            overflow: "hidden",
            touchAction: "none",
            userSelect: "none",
            cursor: cropCursor,
            bgcolor: "#111",
          }}
        >
          {imageSrc ? (
            <Box
              component="img"
              src={imageSrc}
              alt="paste preview"
              draggable={false}
              sx={{
                width: displayWidth,
                height: displayHeight,
                display: "block",
                pointerEvents: "none",
              }}
            />
          ) : null}
          <Box
            sx={{
              position: "absolute",
              left: crop.x * scale,
              top: crop.y * scale,
              width: crop.size * scale,
              height: crop.size * scale,
              border: "2px solid #4fc3f7",
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
              pointerEvents: "none",
            }}
          />
          {(
            [
              { corner: "nw" as const, x: crop.x, y: crop.y },
              { corner: "ne" as const, x: crop.x + crop.size, y: crop.y },
              { corner: "sw" as const, x: crop.x, y: crop.y + crop.size },
              {
                corner: "se" as const,
                x: crop.x + crop.size,
                y: crop.y + crop.size,
              },
            ] as const
          ).map(({ corner, x, y }) => (
            <Box
              key={corner}
              sx={{
                position: "absolute",
                left: x * scale - CROP_HANDLE / 2,
                top: y * scale - CROP_HANDLE / 2,
                width: CROP_HANDLE,
                height: CROP_HANDLE,
                bgcolor: "#4fc3f7",
                border: "1px solid #fff",
                pointerEvents: "none",
              }}
            />
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={applying}>
          Отмена
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleApply()}
          disabled={applying || crop.size < 1}
        >
          {applying ? <CircularProgress size={18} /> : "Применить"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
