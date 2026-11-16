export const SQUARE_CROP_MIN_SIDE = 16;

export type SquareCropRect = { x: number; y: number; size: number };

export type SquareCropCorner = "nw" | "ne" | "sw" | "se";

export type SquareCropDragMode = "move" | SquareCropCorner;

export function maxCenteredSquare(
  width: number,
  height: number,
): SquareCropRect {
  const size = Math.min(width, height);
  return {
    x: Math.floor((width - size) / 2),
    y: Math.floor((height - size) / 2),
    size,
  };
}

export function clampSquareCropRect(
  rect: SquareCropRect,
  imageWidth: number,
  imageHeight: number,
  minSide = SQUARE_CROP_MIN_SIDE,
): SquareCropRect {
  const size = Math.max(
    minSide,
    Math.min(rect.size, imageWidth, imageHeight),
  );
  const x = Math.max(0, Math.min(rect.x, imageWidth - size));
  const y = Math.max(0, Math.min(rect.y, imageHeight - size));
  return { x, y, size };
}

/** Сдвиг квадратного кропа без изменения размера. */
export function moveSquareCropRect(
  origin: SquareCropRect,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number,
  minSide = SQUARE_CROP_MIN_SIDE,
): SquareCropRect {
  return clampSquareCropRect(
    {
      x: origin.x + dx,
      y: origin.y + dy,
      size: origin.size,
    },
    imageWidth,
    imageHeight,
    minSide,
  );
}

/**
 * Ресайз квадратного кропа от угла. Противоположный угол остаётся якорем,
 * сторона всегда квадрат.
 */
export function resizeSquareCropFromCorner(
  origin: SquareCropRect,
  corner: SquareCropCorner,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number,
  minSide = SQUARE_CROP_MIN_SIDE,
): SquareCropRect {
  let size: number;
  let x: number;
  let y: number;

  switch (corner) {
    case "se": {
      // якорь — NW
      x = origin.x;
      y = origin.y;
      size = origin.size + Math.max(dx, dy);
      size = Math.min(size, imageWidth - x, imageHeight - y);
      break;
    }
    case "sw": {
      // якорь — NE
      const right = origin.x + origin.size;
      y = origin.y;
      size = origin.size + Math.max(-dx, dy);
      size = Math.min(size, right, imageHeight - y);
      x = right - size;
      break;
    }
    case "ne": {
      // якорь — SW
      const bottom = origin.y + origin.size;
      x = origin.x;
      size = origin.size + Math.max(dx, -dy);
      size = Math.min(size, imageWidth - x, bottom);
      y = bottom - size;
      break;
    }
    case "nw": {
      // якорь — SE
      const right = origin.x + origin.size;
      const bottom = origin.y + origin.size;
      size = origin.size + Math.max(-dx, -dy);
      size = Math.min(size, right, bottom);
      x = right - size;
      y = bottom - size;
      break;
    }
  }

  size = Math.max(minSide, size);

  // После minSide пересчитать позицию относительно якоря
  switch (corner) {
    case "se":
      return clampSquareCropRect(
        { x: origin.x, y: origin.y, size },
        imageWidth,
        imageHeight,
        minSide,
      );
    case "sw": {
      const right = origin.x + origin.size;
      return clampSquareCropRect(
        { x: right - size, y: origin.y, size },
        imageWidth,
        imageHeight,
        minSide,
      );
    }
    case "ne": {
      const bottom = origin.y + origin.size;
      return clampSquareCropRect(
        { x: origin.x, y: bottom - size, size },
        imageWidth,
        imageHeight,
        minSide,
      );
    }
    case "nw": {
      const right = origin.x + origin.size;
      const bottom = origin.y + origin.size;
      return clampSquareCropRect(
        { x: right - size, y: bottom - size, size },
        imageWidth,
        imageHeight,
        minSide,
      );
    }
  }
}

export function hitTestSquareCropCorner(
  pos: { x: number; y: number },
  crop: SquareCropRect,
  hitRadius: number,
): SquareCropCorner | null {
  const corners: Array<{ corner: SquareCropCorner; x: number; y: number }> = [
    { corner: "nw", x: crop.x, y: crop.y },
    { corner: "ne", x: crop.x + crop.size, y: crop.y },
    { corner: "sw", x: crop.x, y: crop.y + crop.size },
    { corner: "se", x: crop.x + crop.size, y: crop.y + crop.size },
  ];
  let best: SquareCropCorner | null = null;
  let bestDist = Infinity;
  for (const c of corners) {
    const dist = Math.hypot(pos.x - c.x, pos.y - c.y);
    if (dist <= hitRadius && dist < bestDist) {
      bestDist = dist;
      best = c.corner;
    }
  }
  return best;
}
