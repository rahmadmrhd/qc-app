// Model checklist catatan Serah Terima: butir "- [ ]"/"- [x]" tingkat atas. Murni.

export interface ChecklistEntry {
  index: number;
  text: string;
}

/** Butir tercentang; dicocokkan lewat (text, occurrence), occurrence = kemunculan ke-k teks yang sama (mulai 0). */
export interface CheckState {
  text: string;
  by: string;
  at: string;
  occurrence: number;
}

const ITEM = /^- \[([ xX])\] ?(.*)$/;

/** Butir checklist tingkat atas (tanpa indentasi), berurutan. */
export function extractChecklist(note: string): ChecklistEntry[] {
  const out: ChecklistEntry[] = [];
  for (const line of note.split(/\r\n|\r|\n/)) {
    const m = ITEM.exec(line);
    if (m) out.push({ index: out.length, text: (m[2] ?? '').trim() });
  }
  return out;
}

/** Centang hanya milik QC: "- [x]" dari penulis catatan dikembalikan menjadi "- [ ]". */
export function normalizeNoteChecks(note: string): string {
  return note.replace(/^- \[[xX]\]/gm, '- [ ]');
}

function nthIndexByText_(entries: ChecklistEntry[], text: string, k: number): number {
  let seen = 0;
  for (const e of entries) {
    if (e.text !== text) continue;
    if (seen === k) return e.index;
    seen++;
  }
  return -1;
}

/** Centang yang menempel pada tiap butir `note`, sejajar dengan `extractChecklist(note)`. */
export function matchChecks(note: string, checks: CheckState[]): Array<CheckState | null> {
  const entries = extractChecklist(note);
  const result: Array<CheckState | null> = entries.map(() => null);
  for (const c of checks) {
    const at = nthIndexByText_(entries, c.text, c.occurrence);
    if (at >= 0) result[at] = c;
  }
  return result;
}

/**
 * Menyelaraskan centang setelah catatan disunting. Butir tercentang yang masih ada (teks, kemunculan ke-k)
 * dipertahankan walau diurutkan ulang. Yang hilang: bila butir pada urutan yang sama kini berteks baru
 * (bukan butir lama lain) = disunting (reset); bila tidak ada pasangan posisi = dihapus/dikonversi.
 */
export function reconcileChecks(
  oldNote: string,
  checks: CheckState[],
  newNote: string,
): {
  checks: CheckState[];
  resets: Array<{ from: string; to: string }>;
  removed: string[];
} {
  const oldEntries = extractChecklist(oldNote);
  const newEntries = extractChecklist(newNote);
  const oldTexts = new Set(oldEntries.map((e) => e.text));

  const kept: CheckState[] = [];
  const claimed = new Set<number>();
  const lost: Array<{ check: CheckState; oldIndex: number }> = [];
  for (const c of checks) {
    const newAt = nthIndexByText_(newEntries, c.text, c.occurrence);
    if (newAt >= 0) {
      kept.push(c);
      claimed.add(newAt);
    } else {
      lost.push({ check: c, oldIndex: nthIndexByText_(oldEntries, c.text, c.occurrence) });
    }
  }

  const resets: Array<{ from: string; to: string }> = [];
  const removed: string[] = [];
  for (const { check, oldIndex } of lost) {
    const candidate = oldIndex >= 0 ? newEntries[oldIndex] : undefined;
    if (candidate && !claimed.has(candidate.index) && !oldTexts.has(candidate.text)) {
      resets.push({ from: check.text, to: candidate.text });
    } else {
      removed.push(check.text);
    }
  }
  return { checks: kept, resets, removed };
}
