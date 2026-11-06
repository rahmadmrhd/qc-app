// Konversi tempelan WhatsApp menjadi Markdown catatan Serah Terima dan pemecah batch.
// Murni: tanpa API server/DOM.

export interface ParsedHandoverTask {
  customerSuggestion: string;
  note: string;
}

// Awalan ekspor WhatsApp: "[22/10, 10.57] Nama Pengirim: " (isi pesan boleh sebaris atau di baris berikutnya).
// Bagian tanggal/jam memakai regex; nama sampai ":" dipindai manual agar linear untuk baris sangat panjang.
const HANDOVER_WA_STAMP = /^\[\d{1,2}\/\d{1,2}(?:\/\d{2,4})?,?\s+\d{1,2}[.:]\d{2}(?:[.:]\d{2})?\]/;
// Satu karakter tanda baca akhir judul (":", "-", ",", ";") atau spasi.
const HANDOVER_TITLE_TRAIL = /[\s:\-,;]/;
// Penanda butir di awal baris: "- ", "* ", "• ", "1. ", "1) ", lalu kotak centang "[ ]"/"[x]".
const HANDOVER_LIST_MARKER = /^(?:[-*•]\s+|\d+[.)]\s+)/;
const HANDOVER_CHECKBOX_MARKER = /^\[[ xX]\]\s*/;
// Penanda format WhatsApp hanya di batas kata: awalan di awal/setelah spasi atau tanda baca,
// akhiran sebelum spasi/tanda baca/akhir baris.
const HANDOVER_WA_FORMAT =
  /(^|[\s([{.,;:!?"'])([*_~])(?=[^\s*_~])([^*_~\n]*?[^\s*_~])\2(?=$|[\s)\]}.,;:!?"'])/g;

/** Panjang awalan WhatsApp di awal `line` (0 bila bukan awalan): stempel, nama (tanpa ":"), ":" lalu spasi/akhir baris. */
function handoverWaPrefixLength_(line: string): number {
  const stamp = HANDOVER_WA_STAMP.exec(line);
  if (!stamp) return 0;
  const colon = line.indexOf(':', stamp[0].length);
  if (colon <= stamp[0].length) return 0;
  let end = colon + 1;
  if (end < line.length && !/\s/.test(line.charAt(end))) return 0;
  while (end < line.length && /\s/.test(line.charAt(end))) end++;
  return end;
}

export function stripWhatsappPrefix(line: string): string {
  return line.slice(handoverWaPrefixLength_(line));
}

export function convertWhatsappFormatting(line: string): string {
  return line.replace(HANDOVER_WA_FORMAT, (_all, pre: string, mark: string, inner: string) => {
    if (mark === '*') return `${pre}**${inner}**`;
    if (mark === '_') return `${pre}*${inner}*`;
    return `${pre}~~${inner}~~`;
  });
}

// Tanda "*" yang bukan format WhatsApp (mis. "A*B*C", "2*3") di-escape agar Markdown tidak menjadikannya miring.
function handoverEscapeLiteralStars_(text: string): string {
  return text.split('*').join('\\*');
}

/** Format WhatsApp menjadi format editor; "*" literal di luar format di-escape (teks butir tetap apa adanya). */
function handoverFormatLine_(line: string): string {
  let out = '';
  let last = 0;
  for (const m of line.matchAll(HANDOVER_WA_FORMAT)) {
    const at = m.index ?? 0;
    out += handoverEscapeLiteralStars_(line.slice(last, at));
    out += convertWhatsappFormatting(m[0]);
    last = at + m[0].length;
  }
  return out + handoverEscapeLiteralStars_(line.slice(last));
}

/** Baris item = memuat pemisah jumlah "=" atau ":" diikuti angka (spasi di sekitarnya bebas). */
export function isChecklistLine(line: string): boolean {
  return /[=:]\s*\d/.test(line);
}

// Membersihkan satu baris: awalan WhatsApp, tab/spasi ganda, penanda butir.
function handoverCleanLine_(raw: string): string {
  let s = stripWhatsappPrefix(raw.replace(/\t/g, ' ').trim());
  s = s.replace(/ {2,}/g, ' ').trim();
  s = s.replace(HANDOVER_LIST_MARKER, '');
  s = s.replace(HANDOVER_CHECKBOX_MARKER, '');
  return s.trim();
}

function handoverCleanLines_(raw: string): string[] {
  return raw
    .split(/\r\n|\r|\n/)
    .map(handoverCleanLine_)
    .filter((l) => l !== '');
}

// Butir berurutan rapat; paragraf dan blok checklist dipisah satu baris kosong.
function handoverLinesToNote_(lines: string[]): string {
  const blocks: string[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length > 0) blocks.push(items.join('\n'));
    items = [];
  };
  for (const line of lines) {
    const text = handoverFormatLine_(line);
    if (isChecklistLine(line)) {
      items.push(`- [ ] ${text}`);
    } else {
      flush();
      blocks.push(text);
    }
  }
  flush();
  return blocks.join('\n\n');
}

export function whatsappToNoteMarkdown(raw: string): string {
  return handoverLinesToNote_(handoverCleanLines_(raw));
}

interface HandoverPasteLine {
  text: string;
  /** Baris ini pembuka pesan WhatsApp baru (awalan `[tanggal, jam] Nama:`). */
  start: boolean;
}

function handoverPasteLines_(raw: string): HandoverPasteLine[] {
  const out: HandoverPasteLine[] = [];
  let pendingStart = false;
  for (const line of raw.split(/\r\n|\r|\n/)) {
    if (handoverWaPrefixLength_(line.replace(/\t/g, ' ').trim()) > 0) pendingStart = true;
    const text = handoverCleanLine_(line);
    if (text === '') continue;
    out.push({ text, start: pendingStart });
    pendingStart = false;
  }
  return out;
}

/** Usulan customer dari judul: tanda baca AKHIR (`: - , ;`) dan spasi dibuang, selebihnya utuh. */
function handoverTitleToCustomer_(title: string): string {
  let end = title.length;
  while (end > 0 && HANDOVER_TITLE_TRAIL.test(title.charAt(end - 1))) end--;
  return title.slice(0, end).trim();
}

/**
 * Memecah tempelan besar menjadi task. Judul = baris non-item yang LANGSUNG diikuti baris item (baris kosong
 * diabaikan) dalam pesan yang sama, apa pun simbol akhirnya. Tiap pesan WhatsApp memulai blok baru. Judul tidak
 * masuk `note`; baris lain mengikuti task sampai judul/pesan berikutnya. Teks sebelum judul pertama menjadi
 * task tanpa usulan customer.
 */
export function splitWhatsappBatch(raw: string): ParsedHandoverTask[] {
  const groups: { customerSuggestion: string; lines: string[] }[] = [];
  let current: { customerSuggestion: string; lines: string[] } | null = null;
  const lines = handoverPasteLines_(raw);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as HandoverPasteLine;
    const next = lines[i + 1];
    const isTitle =
      !isChecklistLine(line.text) &&
      next !== undefined &&
      !next.start &&
      isChecklistLine(next.text);
    if (line.start || !current || (isTitle && current.lines.length > 0)) {
      current = { customerSuggestion: '', lines: [] };
      groups.push(current);
    }
    if (isTitle) {
      current.customerSuggestion = handoverTitleToCustomer_(line.text);
      continue;
    }
    current.lines.push(line.text);
  }
  return groups
    .map((g) => ({
      customerSuggestion: g.customerSuggestion,
      note: handoverLinesToNote_(g.lines),
    }))
    .filter((t) => t.note !== '');
}
