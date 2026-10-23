// Jangkar komentar pada teks polos catatan. Murni.

const CONTEXT = 20;

export interface CommentAnchor {
  quote: string;
  before: string;
  after: string;
}

/** Teks polos catatan: penanda Markdown dibuang, blok dipisah "\n", baris kosong dibuang. */
export function noteToPlainText(note: string): string {
  const lines: string[] = [];
  for (const raw of note.split(/\r\n|\r|\n/)) {
    let s = raw.trim();
    s = s.replace(/^(?:#{1,6}\s+|>\s?)/, '');
    s = s.replace(/^(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/, '');
    s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
    s = s.replace(/`([^`]*)`/g, '$1');
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/~~([^~]+)~~/g, '$1');
    s = s.replace(/(^|[\s([{.,;:!?"'])\*([^*\n]+)\*(?=$|[\s)\]}.,;:!?"'])/g, '$1$2');
    s = s.replace(/(^|[\s([{.,;:!?"'])_([^_\n]+)_(?=$|[\s)\]}.,;:!?"'])/g, '$1$2');
    s = s.replace(/\\([\\`*_{}[\]()#+\-.!~>|])/g, '$1').trim();
    if (s !== '') lines.push(s);
  }
  return lines.join('\n');
}

export function makeAnchor(plain: string, start: number, end: number): CommentAnchor {
  return {
    quote: plain.slice(start, end),
    before: plain.slice(Math.max(0, start - CONTEXT), start),
    after: plain.slice(end, end + CONTEXT),
  };
}

function commonSuffix_(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefix_(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Mencari kutipan; bila muncul berkali-kali pilih yang konteks before/after-nya paling cocok.
 * null = usang (kutipan hilang, atau ganda tanpa konteks yang cocok sama sekali).
 */
export function locateAnchor(
  plain: string,
  anchor: CommentAnchor,
): { start: number; end: number } | null {
  const { quote } = anchor;
  if (quote === '') return null;
  const found: number[] = [];
  for (let i = plain.indexOf(quote); i >= 0; i = plain.indexOf(quote, i + 1)) found.push(i);
  if (found.length === 0) return null;
  const first = found[0];
  if (found.length === 1 && first !== undefined) return { start: first, end: first + quote.length };
  let best = -1;
  let bestEnd = -1;
  let bestScore = 0;
  for (const s of found) {
    const e = s + quote.length;
    const score =
      commonSuffix_(anchor.before, plain.slice(Math.max(0, s - CONTEXT), s)) +
      commonPrefix_(anchor.after, plain.slice(e, e + CONTEXT));
    if (score > bestScore) {
      bestScore = score;
      best = s;
      bestEnd = e;
    }
  }
  return best < 0 ? null : { start: best, end: bestEnd };
}
