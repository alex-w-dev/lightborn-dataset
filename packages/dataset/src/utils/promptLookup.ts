/** Lookup text prompt by key in a bundled prompts map (id / icon → text). */
export function lookupPromptText(
  prompts: Record<string, string>,
  key: string,
): string {
  const raw = prompts[key];
  if (typeof raw !== "string") return "";
  return raw.replace(/^\uFEFF/, "").trim();
}
