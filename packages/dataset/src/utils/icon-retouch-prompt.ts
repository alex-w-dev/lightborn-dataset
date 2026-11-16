/** Категория фона доработки иконки (ручной выбор в UI). */
export type IconRetouchBgCategory =
  | "weapon"
  | "armor"
  | "shield"
  | "accessory"
  | "consumable"
  | "material"
  | "quest"
  | "junk";

export const ICON_RETOUCH_BG_HEX: Record<IconRetouchBgCategory, string> = {
  weapon: "#242528",
  armor: "#18212A",
  shield: "#2B1D1D",
  accessory: "#18212A",
  consumable: "#162824",
  material: "#2B1D1D",
  quest: "#2E1F29",
  junk: "#222220",
};

export const ICON_RETOUCH_PROMPT_TEMPLATE =
  `Измени фон этого изображения предмета: широкий фон <цвет для фона>, который щедро выступает слева и справа.
За предметом большая широкая черная мягкая тень по всему его краю, одинаковая сверху и снизу, плавно уходящая в фон.
Свечение и градиент на фоне убери, нужна только черная рассеянная тень от предмета.
Предмет сделай светлее фона. Яркость предмета выше среднего.
Все детали предмета с исходной картинки сохрани.
Расположение предмета не меняй. Без рамки, без текста.`;

const ICON_RETOUCH_BG_COLOR_RE = /на широком фоне #[0-9A-Fa-f]{6}/;

export function buildIconRetouchPrompt(hex: string): string {
  return ICON_RETOUCH_PROMPT_TEMPLATE.replace("<цвет для фона>", hex);
}

/** Подставляет цвет фона в шаблон промпта, не трогая остальной текст. */
export function applyIconRetouchPromptColor(
  prompt: string,
  hex: string,
): string {
  const text = String(prompt ?? "");
  if (text.includes("<цвет для фона>")) {
    return text.replace("<цвет для фона>", hex);
  }
  if (ICON_RETOUCH_BG_COLOR_RE.test(text)) {
    return text.replace(ICON_RETOUCH_BG_COLOR_RE, `на широком фоне ${hex}`);
  }
  return buildIconRetouchPrompt(hex);
}
