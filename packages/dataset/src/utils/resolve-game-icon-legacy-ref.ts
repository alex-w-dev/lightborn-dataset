/** new→old имя иконки из rename-map; иначе сам ref. */
export function resolveGameIconLegacyRef(
  icon: string,
  iconRenameMap?: Record<string, string> | null,
): string {
  const key = String(icon ?? "").trim();
  if (!key) return key;
  const mapped = iconRenameMap?.[key];
  if (typeof mapped === "string" && mapped.trim()) {
    return mapped.trim();
  }
  return key;
}
