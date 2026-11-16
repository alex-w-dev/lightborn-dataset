/**
 * Подмена слов/фраз, которые часто режет модерация площадок (Шедеврум и т.п.):
 * черепа, кровь/gore, демоны, явная религия, жестокость, emblem.
 *
 * Не трогаем нейтральные weapon-термины: crossguard, crossed swords.
 * `crossbow` → `bow` (ниже в правилах).
 * Порядок: сначала длинные фразы, потом одиночные слова.
 */

export type GameIconPromptSanitizeRule = {
  /** Case-insensitive; без флага g — добавим сами. */
  pattern: RegExp;
  replace: string;
};

/**
 * Правила подмены для промптов иконок (All-prompts + автопромпт).
 * Экспорт для тестов / документации.
 */
export const GAME_ICON_PROMPT_PLATFORM_SANITIZE_RULES: GameIconPromptSanitizeRule[] =
  [
    // --- gore / blood ---
    { pattern: /\bblood\s+splatters?\b/gi, replace: "crimson energy accents" },
    { pattern: /\bblood\s+splatter\b/gi, replace: "crimson energy accent" },
    { pattern: /\bbloody\b/gi, replace: "crimson-tinted" },
    { pattern: /\bblood[- ]red\b/gi, replace: "deep crimson" },
    { pattern: /\bblood\b/gi, replace: "crimson" },
    { pattern: /\bgore\b/gi, replace: "dramatic red accents" },
    { pattern: /\bgory\b/gi, replace: "intense crimson" },
    { pattern: /\bexploding\s+torso\b/gi, replace: "bursting armor energy" },
    { pattern: /\bsevered\b/gi, replace: "broken" },
    { pattern: /\bdecapitat(?:e|ed|ion)\b/gi, replace: "dramatic shatter" },
    { pattern: /\bdismember(?:ed|ment)?\b/gi, replace: "fragmented" },
    { pattern: /\btorture\b/gi, replace: "harsh ordeal" },
    { pattern: /\bcorpse\b/gi, replace: "fallen figure" },
    { pattern: /\bdead\s+body\b/gi, replace: "fallen figure" },
    { pattern: /\bentrails?\b/gi, replace: "organic ribbons" },
    { pattern: /\bguts\b/gi, replace: "crimson ribbons" },

    // --- skull / death imagery (без слова emblem — его тоже режет площадка) ---
    { pattern: /\bwhite\s+bone\s+skull\b/gi, replace: "carved ivory ornament" },
    { pattern: /\bbone\s+skull\b/gi, replace: "carved ivory ornament" },
    { pattern: /\bant\s+skull\b/gi, replace: "ant-shaped carved ornament" },
    {
      pattern: /\bdragon\s+skull\b/gi,
      replace: "dragon-shaped carved ornament",
    },
    { pattern: /\bskeletal\s+head\b/gi, replace: "carved ivory headpiece" },
    { pattern: /\bskull\s+fragment\b/gi, replace: "carved bone fragment" },
    {
      pattern: /\bcentral\s+skull\s+abstract\s+motif\b/gi,
      replace: "central ornate abstract ornament",
    },
    {
      pattern: /\bcentral\s+skull\s+motif\b/gi,
      replace: "central ornate ornament motif",
    },
    {
      pattern: /\babstract\s+skull\s+motif\b/gi,
      replace: "abstract ornate ornament motif",
    },
    { pattern: /\bskull\s+motif\b/gi, replace: "ornate ornament motif" },
    { pattern: /\bskull\s+emblem\b/gi, replace: "ornate metal ornament" },
    { pattern: /\bskull\s+centerpiece\b/gi, replace: "ornate centerpiece" },
    { pattern: /\bskull\s+texture\b/gi, replace: "carved ivory texture" },
    { pattern: /\bhorned\s+skull\b/gi, replace: "horned ornate ornament" },
    { pattern: /\bskulls\b/gi, replace: "ornate ornaments" },
    { pattern: /\bskull\b/gi, replace: "ornate ornament" },
    { pattern: /\bskeletal\b/gi, replace: "bone-structured" },

    // --- demonic ---
    { pattern: /\bdemonic\s+fang\b/gi, replace: "dark fantasy fang" },
    { pattern: /\bdemonic\s+horn\b/gi, replace: "curved fantasy horn" },
    { pattern: /\bdemonic\s+eye\b/gi, replace: "glowing eye" },
    { pattern: /\bdemonic\b/gi, replace: "dark fantasy" },
    { pattern: /\bdemons?\b/gi, replace: "shadow creatures" },
    { pattern: /\bdevil(?:ish)?\b/gi, replace: "sinister" },
    { pattern: /\bsatanic\b/gi, replace: "occult-styled" },
    { pattern: /\bsatan\b/gi, replace: "shadow" },
    { pattern: /\bpentagrams?\b/gi, replace: "five-point star ornaments" },
    { pattern: /\bpentacle\b/gi, replace: "star ornament" },

    // --- religion (не трогаем crossguard / crossed) ---
    { pattern: /\bcrucifix[- ]shaped\b/gi, replace: "geometric-shaped" },
    { pattern: /\bcrucifix\s+motif\b/gi, replace: "geometric ornament motif" },
    { pattern: /\bcrucifix\b/gi, replace: "geometric ornament" },
    {
      pattern: /\bengraved\s+cross\s+symbol\b/gi,
      replace: "engraved geometric ornament",
    },
    { pattern: /\bcross\s+symbol\b/gi, replace: "geometric ornament" },
    { pattern: /\bcross\s+motifs?\b/gi, replace: "geometric ornaments" },
    {
      pattern: /\bgolden\s+cross\s+motif\b/gi,
      replace: "golden geometric ornament",
    },
    { pattern: /\bcross[- ]shaped\b/gi, replace: "plus-shaped" },
    { pattern: /\bfeaturing\s+cross\b/gi, replace: "featuring geometric mark" },
    { pattern: /\bwith\s+a\s+cross\b/gi, replace: "with a geometric ornament" },
    { pattern: /\bwhite\s+cross\b/gi, replace: "white geometric mark" },
    {
      pattern: /\bmetallic\s+cross\b/gi,
      replace: "metallic geometric ornament",
    },
    { pattern: /\bblessed\b/gi, replace: "enchanted" },
    { pattern: /\bholy\b/gi, replace: "radiant" },
    { pattern: /\bsacred\b/gi, replace: "revered" },
    { pattern: /\bangelic\b/gi, replace: "celestial" },
    { pattern: /\bangels?\b/gi, replace: "winged figures" },
    { pattern: /\bjesus\b/gi, replace: "figure" },
    { pattern: /\bchrist\b/gi, replace: "figure" },
    { pattern: /\bbible\b/gi, replace: "tome" },
    { pattern: /\bchurch\b/gi, replace: "stone hall" },
    { pattern: /\bmosque\b/gi, replace: "stone hall" },
    { pattern: /\btemple\s+worship\b/gi, replace: "ancient hall" },

    // --- emblem (само по себе триггерит модерацию) ---
    { pattern: /\bemblems\b/gi, replace: "ornaments" },
    { pattern: /\bemblem\b/gi, replace: "ornament" },

    // --- «war …» (насилие в названии оружия) ---
    { pattern: /\bwar\s+axes?\b/gi, replace: "axe" },
    { pattern: /\bwar\s+hammers?\b/gi, replace: "hammer" },
    { pattern: /\bwar\s+maces?\b/gi, replace: "mace" },
    { pattern: /\bwar\s+clubs?\b/gi, replace: "club" },
    { pattern: /\bbattle\s+axes?\b/gi, replace: "axe" },
    { pattern: /\bbattle\s+hammers?\b/gi, replace: "hammer" },

    // --- crossbow → bow (subject/All-prompts) ---
    { pattern: /\bcrossbows\b/gi, replace: "bows" },
    { pattern: /\bcrossbow\b/gi, replace: "bow" },

    // --- NSFW / extreme ---
    { pattern: /\bnude\b/gi, replace: "clad" },
    { pattern: /\bnaked\b/gi, replace: "clad" },
    { pattern: /\berotic\b/gi, replace: "stylized" },
    { pattern: /\bnsfw\b/gi, replace: "safe" },
    { pattern: /\bporn\w*\b/gi, replace: "stylized" },
  ];

/** Сжимает лишние пробелы/запятые после подмен. */
function tidyPrompt(text: string): string {
  return text
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();
}

/**
 * Подмена флажных слов для модерации площадки.
 * Идемпотентна для уже заменённых фраз.
 */
export function sanitizeGameIconPromptForPlatform(prompt: string): string {
  let text = String(prompt ?? "");
  if (!text.trim()) return text;

  for (const rule of GAME_ICON_PROMPT_PLATFORM_SANITIZE_RULES) {
    text = text.replace(rule.pattern, rule.replace);
  }
  return tidyPrompt(text);
}
