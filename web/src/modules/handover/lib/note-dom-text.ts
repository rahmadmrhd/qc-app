import type { CommentAnchor } from '@shared/handover-comments';
import { handoverNormalizeAnchorText, locateAnchor } from '@shared/handover-comments';

const BLOCK_SELECTOR = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,pre';
/** Teks di dalam elemen ini (mis. "oleh … · waktu") bukan isi catatan dan dilewati. */
const SKIP_SELECTOR = '[data-note-meta]';

export interface NoteDomText {
  /** Teks DOM berpemisah blok `\n`, selaras dengan `noteToPlainText` (tiap blok dipangkas, kosong dibuang). */
  plain: string;
  /** Rentang DOM untuk [start, end) pada `plain`; null bila di luar jangkauan. */
  rangeFor: (start: number, end: number) => Range | null;
}

interface CharRef {
  node: Text;
  offset: number;
}

function blockOf(node: Text, root: HTMLElement): Element | null {
  const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? null;
  return block && root.contains(block) ? block : null;
}

/**
 * Membangun teks polos dari DOM catatan: node teks dikelompokkan per blok; pemisah antarblok `\n` sehingga
 * kutipan lintas butir dan kutipan berulang dapat dicari dengan `locateAnchor` seperti di server.
 */
export function collectNoteText(root: HTMLElement): NoteDomText {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const groups: Array<{ block: Element | null; nodes: Text[] }> = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    if (node.parentElement?.closest(SKIP_SELECTOR)) continue;
    const block = blockOf(node, root);
    const last = groups[groups.length - 1];
    if (last && last.block === block && block !== null) last.nodes.push(node);
    else groups.push({ block, nodes: [node] });
  }

  const chars: CharRef[] = [];
  let plain = '';
  for (const group of groups) {
    const refs: CharRef[] = [];
    let text = '';
    for (const node of group.nodes) {
      const data = handoverNormalizeAnchorText(node.data);
      for (let i = 0; i < data.length; i++) refs.push({ node, offset: i });
      text += data;
    }
    const trimmedStart = text.length - text.trimStart().length;
    const trimmed = text.trim();
    if (trimmed === '') continue;
    if (plain !== '') {
      plain += '\n';
      chars.push({ node: refs[trimmedStart]?.node as Text, offset: -1 });
    }
    plain += trimmed;
    chars.push(...refs.slice(trimmedStart, trimmedStart + trimmed.length));
  }

  return {
    plain,
    rangeFor(start, end) {
      if (start < 0 || end > plain.length || start >= end) return null;
      let first = start;
      while (chars[first]?.offset === -1) first++;
      let last = end - 1;
      while (last > first && chars[last]?.offset === -1) last--;
      const a = chars[first];
      const b = chars[last];
      if (!a || !b || a.offset < 0 || b.offset < 0) return null;
      const range = doc.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset + 1);
      return range;
    },
  };
}

/** Rentang DOM kutipan komentar (kemunculan yang benar lewat konteks); null bila usang/tidak ditemukan. */
export function rangeForAnchor(root: HTMLElement, anchor: CommentAnchor): Range | null {
  const { plain, rangeFor } = collectNoteText(root);
  const found = locateAnchor(plain, anchor);
  return found ? rangeFor(found.start, found.end) : null;
}

type HighlightCtor = new (...ranges: Range[]) => unknown;
interface HighlightRegistry {
  set: (name: string, value: unknown) => void;
  delete: (name: string) => void;
}

const HIGHLIGHT_NAME = 'qc-comment';
// Banyak catatan (kartu) tampil sekaligus dan berbagi satu nama sorotan: gabungkan rentang semua pemilik.
const rangesByOwner = new Map<object, Range[]>();

function flushHighlights(): void {
  const registry = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights;
  const Ctor = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  if (!registry || !Ctor) return;
  const all = [...rangesByOwner.values()].flat();
  if (all.length === 0) registry.delete(HIGHLIGHT_NAME);
  else registry.set(HIGHLIGHT_NAME, new Ctor(...all));
}

/** Memasang sorotan kutipan milik `owner` (mis. satu NoteView); `[]` melepasnya. */
export function setNoteHighlights(owner: object, ranges: Range[]): void {
  if (ranges.length === 0) rangesByOwner.delete(owner);
  else rangesByOwner.set(owner, ranges);
  flushHighlights();
}
