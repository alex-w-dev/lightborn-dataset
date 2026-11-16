import { gameIconImgKind } from "./asset-paths";

/** Стиль прорисовки иконок (общая часть, не в description). */
export const ASSET_ICON_RENDER_STYLE_PROMPT =
  "detailed hand-painted rendering, deep shadows, volumetric shading, sharp specular highlights, richly textured surfaces";

export const ASSET_ICON_SQUARE_NO_FRAME_PROMPT =
  "square icon, no frame, no border";

export const ASSET_ICON_NO_OUTLINE_PROMPT =
  "no black outline, soft painted edges";

/** Common для предметов (не пишется в description / embeddings). */
export const ASSET_ICON_ITEM_COMMON_PROMPT = [
  "serious fantasy RPG item illustration for a game UI",
  ASSET_ICON_RENDER_STYLE_PROMPT,
  "centered",
  ASSET_ICON_SQUARE_NO_FRAME_PROMPT,
  ASSET_ICON_NO_OUTLINE_PROMPT,
].join(", ");

/** Common для скиллов. */
export const ASSET_ICON_SKILL_COMMON_PROMPT = [
  "serious fantasy RPG skill illustration for a game UI",
  ASSET_ICON_RENDER_STYLE_PROMPT,
  "centered",
  "subtle magic glow",
  ASSET_ICON_SQUARE_NO_FRAME_PROMPT,
  ASSET_ICON_NO_OUTLINE_PROMPT,
].join(", ");

/** Common для монстров / портретов. */
export const ASSET_MONSTER_COMMON_PROMPT =
  "stylized fantasy RPG concept art, half-body portrait, centered";

/** Negative по умолчанию для SD-иконок. */
export const ASSET_ICON_DEFAULT_NEGATIVE_PROMPT =
  "frame, border, picture frame, ornate frame, ui frame, rounded corners, corner rounding, rounded edges, soft corners, circular frame, rounded rectangle, rounded border, circular crop, beveled corners, soft edge frame, black outline, thick outline, ink outline, hard outline, cel shading, cartoon, comic book, anime lineart, line art stroke, flat shading, flat colors, underdetailed, simple cartoon, plastic look, text, letters, words, watermark, signature, logo, caption, female clothing, feminine outfit, dress, skirt";

/** @deprecated alias — совместимость с прежним именем. */
export const GAME_ICONS_DEFAULT_NEGATIVE_PROMPT =
  ASSET_ICON_DEFAULT_NEGATIVE_PROMPT;

/** @deprecated alias */
export const GAME_ICONS_ITEM_PROMPT_FRAGMENT = ASSET_ICON_ITEM_COMMON_PROMPT;

/** @deprecated alias */
export const GAME_ICONS_SKILL_PROMPT_FRAGMENT = ASSET_ICON_SKILL_COMMON_PROMPT;

/** @deprecated alias */
export const GAME_ICON_RENDER_STYLE_PROMPT = ASSET_ICON_RENDER_STYLE_PROMPT;

/**
 * Склейка common + content. Не генерирует subject из каталога.
 * Common не должен попадать в description.
 */
export function composeAssetPrompt(
  common: string,
  content: string,
): string {
  const parts = [String(common ?? "").trim(), String(content ?? "").trim()].filter(
    Boolean,
  );
  return parts.join(", ");
}

/** Common для иконки по id (`g*` / `s*`). */
export function assetIconCommonPrompt(iconId: string): string {
  return gameIconImgKind(iconId) === "skills"
    ? ASSET_ICON_SKILL_COMMON_PROMPT
    : ASSET_ICON_ITEM_COMMON_PROMPT;
}

export function composeGameIconPrompt(
  iconId: string,
  description: string,
): string {
  return composeAssetPrompt(assetIconCommonPrompt(iconId), description);
}
