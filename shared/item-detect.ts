// Deteksi nama Item pada catatan task Serah Terima (Keluar Gudang 5.14). Murni.

import { noteToPlainText } from './handover-comments';
import { itemKey, normalizeKey } from './items';

export interface DetectableItem {
  id: string;
  brandName: string;
  model: string;
}

export interface ItemDetection {
  itemId: string;
  /** Jumlah baris catatan (teks polos) yang menyebutnya. */
  lines: number;
  /** Cocok lewat merk+tipe, atau tipe saja (hanya bila unik). */
  by: 'full' | 'model';
  /** Nama rapat sama dengan Item lain yang juga dilaporkan. */
  ambiguous: boolean;
}

/** Nama rapat yang lebih pendek dari ini dilewati (terlalu mudah cocok secara kebetulan). */
export const ITEM_DETECT_MIN_COMPACT = 4;

export function itemDisplayName(item: Pick<DetectableItem, 'brandName' | 'model'>): string {
  return `${item.brandName} ${item.model}`.trim();
}

/** `normalizeKey(text)` tanpa spasi. */
export function compactKey(text: string): string {
  return normalizeKey(text).split(' ').join('');
}

interface CompactLine {
  normalized: string;
  text: string;
  /** Indeks teks rapat -> indeks teks bernormalisasi. */
  map: number[];
}

function spaceOrEdge(normalized: string, index: number): boolean {
  return index < 0 || index >= normalized.length || normalized.charAt(index) === ' ';
}

function compactLine(normalized: string): CompactLine {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    if (normalized.charAt(i) === ' ') continue;
    text += normalized.charAt(i);
    map.push(i);
  }
  return { normalized, text, map };
}

function countInLine(line: CompactLine, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let from = 0;
  while (from <= line.text.length - needle.length) {
    const at = line.text.indexOf(needle, from);
    if (at < 0) break;
    const startNorm = line.map[at] as number;
    const endNorm = line.map[at + needle.length - 1] as number;
    if (spaceOrEdge(line.normalized, startNorm - 1) && spaceOrEdge(line.normalized, endNorm + 1)) {
      count++;
      from = at + needle.length;
    } else {
      from = at + 1;
    }
  }
  return count;
}

/**
 * Jumlah kecocokan `needle` (bentuk rapat) di `normalized` (hasil `normalizeKey`), hanya yang berbatas
 * spasi/awal/akhir pada teks bernormalisasi.
 */
export function countBoundedMatches(normalized: string, needle: string): number {
  return countInLine(compactLine(normalized), needle);
}

export interface ItemMatcher {
  item: DetectableItem;
  full: string;
  model: string;
  fullOk: boolean;
  modelOk: boolean;
}

/** Kunci rapat tiap Item dihitung sekali (mahal pada katalog besar); dipakai ulang untuk banyak catatan. */
export function prepareItemMatchers(items: readonly DetectableItem[]): readonly ItemMatcher[] {
  const modelCount = new Map<string, number>();
  for (const item of items) {
    const key = compactKey(item.model);
    modelCount.set(key, (modelCount.get(key) ?? 0) + 1);
  }
  const out: ItemMatcher[] = [];
  for (const item of items) {
    const full = compactKey(itemKey(item.brandName, item.model));
    const model = compactKey(item.model);
    const fullOk = full.length >= ITEM_DETECT_MIN_COMPACT;
    const modelOk = model.length >= ITEM_DETECT_MIN_COMPACT && modelCount.get(model) === 1;
    if (!fullOk && !modelOk) continue;
    out.push({ item, full, model, fullOk, modelOk });
  }
  return out;
}

function compactLinesOf(note: string): CompactLine[] {
  return noteToPlainText(note)
    .split('\n')
    .map((line) => normalizeKey(line))
    .filter((line) => line !== '')
    .map(compactLine);
}

/** Item yang disebut pada `note`, urut `lines` menurun lalu nama tampilan. */
export function detectItemsInNote(
  note: string,
  items: readonly DetectableItem[],
  prepared: readonly ItemMatcher[] = prepareItemMatchers(items),
): ItemDetection[] {
  const lines = compactLinesOf(note);
  if (lines.length === 0 || prepared.length === 0) return [];

  const found: { item: DetectableItem; lines: number; by: 'full' | 'model'; needle: string }[] = [];
  for (const { item, full, model, fullOk, modelOk } of prepared) {
    let matchedLines = 0;
    let viaFull = false;
    for (const line of lines) {
      if (fullOk && countInLine(line, full) > 0) {
        matchedLines++;
        viaFull = true;
      } else if (modelOk && countInLine(line, model) > 0) {
        matchedLines++;
      }
    }
    if (matchedLines === 0) continue;
    found.push({
      item,
      lines: matchedLines,
      by: viaFull ? 'full' : 'model',
      needle: viaFull ? full : model,
    });
  }

  const needleCount = new Map<string, number>();
  for (const f of found) needleCount.set(f.needle, (needleCount.get(f.needle) ?? 0) + 1);
  const ranked = found.map((f) => ({
    name: itemDisplayName(f.item),
    detection: {
      itemId: f.item.id,
      lines: f.lines,
      by: f.by,
      ambiguous: (needleCount.get(f.needle) ?? 0) > 1,
    } satisfies ItemDetection,
  }));
  ranked.sort((a, b) => b.detection.lines - a.detection.lines || a.name.localeCompare(b.name));
  return ranked.map((r) => r.detection);
}

/**
 * Menggolongkan baris catatan (teks polos, urutan catatan) terhadap Item terpilih `itemId`, dengan mesin pencocokan
 * per baris yang sama dengan `detectItemsInNote`: `matched` = baris yang menyebut Item terpilih; `other` = baris yang
 * menyebut Item LAIN dan tidak menyebut Item terpilih (bahan konfirmasi kecocokan sebelum pengeluaran disimpan).
 */
export function classifyNoteLines(
  note: string,
  itemId: string,
  items: readonly DetectableItem[],
  prepared: readonly ItemMatcher[] = prepareItemMatchers(items),
): { matched: string[]; other: string[] } {
  const matched: string[] = [];
  const other: string[] = [];
  for (const raw of noteToPlainText(note).split('\n')) {
    const text = raw.trim();
    if (text === '') continue;
    const line = compactLine(normalizeKey(text));
    let mentionsSelected = false;
    let mentionsOther = false;
    for (const { item, full, model, fullOk, modelOk } of prepared) {
      const hit =
        (fullOk && countInLine(line, full) > 0) || (modelOk && countInLine(line, model) > 0);
      if (!hit) continue;
      if (item.id === itemId) mentionsSelected = true;
      else mentionsOther = true;
    }
    if (mentionsSelected) matched.push(text);
    else if (mentionsOther) other.push(text);
  }
  return { matched, other };
}

export function linesMentioningOtherItems(
  note: string,
  itemId: string,
  items: readonly DetectableItem[],
  prepared: readonly ItemMatcher[] = prepareItemMatchers(items),
): string[] {
  return classifyNoteLines(note, itemId, items, prepared).other;
}

export function noteMentionsItem(
  note: string,
  itemId: string,
  items: readonly DetectableItem[],
  prepared: readonly ItemMatcher[] = prepareItemMatchers(items),
): boolean {
  return detectItemsInNote(note, items, prepared).some((d) => d.itemId === itemId);
}
