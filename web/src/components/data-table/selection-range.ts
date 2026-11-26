/** Id dari `anchorId` sampai `targetId` (inklusif) menurut urutan `orderedIds`, ke arah mana pun. `[]` bila salah satunya tidak ada. */
export function rangeBetween(
  orderedIds: readonly string[],
  anchorId: string,
  targetId: string,
): string[] {
  const from = orderedIds.indexOf(anchorId);
  const to = orderedIds.indexOf(targetId);
  if (from < 0 || to < 0) return [];
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return orderedIds.slice(start, end + 1);
}
