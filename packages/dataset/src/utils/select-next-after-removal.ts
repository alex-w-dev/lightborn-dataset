/**
 * После удаления текущего элемента из видимого списка выбирает следующий
 * (на той же позиции), либо предыдущий, если удалённый был последним.
 */
export function selectNextAfterRemoval<T>(
  visibleItems: readonly T[],
  removed: T,
): T | null {
  const idx = visibleItems.findIndex((item) => item === removed);
  const remaining = visibleItems.filter((item) => item !== removed);
  if (remaining.length === 0) return null;
  const nextIdx = idx >= 0 ? Math.min(idx, remaining.length - 1) : 0;
  return remaining[nextIdx] ?? remaining[0] ?? null;
}
