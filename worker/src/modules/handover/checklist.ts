import type { ChecklistEntry, CheckState } from '@shared/handover-checklist';
import { extractChecklist, matchChecksToEntries } from '@shared/handover-checklist';

/**
 * Memo kecil per isolate untuk `extractChecklist`: satu catatan dipakai berkali-kali dalam satu permintaan
 * (validasi, kolom turunan, DTO, snapshot audit). Kunci = isi catatan, jadi tidak ada yang basi; dibatasi
 * agar memori isolate tetap kecil.
 */
const MEMO_MAX = 48;
const memo = new Map<string, readonly ChecklistEntry[]>();

export function checklistOf(note: string): readonly ChecklistEntry[] {
  const hit = memo.get(note);
  if (hit) return hit;
  const entries = extractChecklist(note);
  if (memo.size >= MEMO_MAX) {
    const oldest = memo.keys().next();
    if (!oldest.done) memo.delete(oldest.value);
  }
  memo.set(note, entries);
  return entries;
}

/** `matchChecks` memakai memo butir; hasil sejajar dengan `checklistOf(note)`. */
export function matchedChecks(
  note: string,
  checks: readonly CheckState[],
): Array<CheckState | null> {
  return matchChecksToEntries(checklistOf(note), checks);
}
