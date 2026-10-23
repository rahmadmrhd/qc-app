// Konversi tempelan WhatsApp menjadi Markdown catatan Serah Terima dan pemecah batch.
// Murni: tanpa API GAS/DOM.

export interface ParsedHandoverTask {
  customerSuggestion: string;
  note: string;
}

// Awalan ekspor WhatsApp: "[22/10, 10.57] Nama Pengirim: ".
const WA_PREFIX =
  /^\[\d{1,2}\/\d{1,2}(?:\/\d{2,4})?,?\s+\d{1,2}[.:]\d{2}(?:[.:]\d{2})?\]\s*[^:]+?:\s+/;
// Penanda butir di awal baris: "- ", "* ", "• ", "1. ", "1) ", lalu kotak centang "[ ]"/"[x]".
const LIST_MARKER = /^(?:[-*•]\s+|\d+[.)]\s+)/;
const CHECKBOX_MARKER = /^\[[ xX]\]\s*/;
// Penanda format WhatsApp hanya di batas kata: awalan di awal/setelah spasi atau tanda baca,
// akhiran sebelum spasi/tanda baca/akhir baris.
const WA_FORMAT =
  /(^|[\s([{.,;:!?"'])([*_~])(?=[^\s*_~])([^*_~\n]*?[^\s*_~])\2(?=$|[\s)\]}.,;:!?"'])/g;

export function stripWhatsappPrefix(line: string): string {
  return line.replace(WA_PREFIX, '');
}

export function convertWhatsappFormatting(line: string): string {
  return line.replace(WA_FORMAT, (_all, pre: string, mark: string, inner: string) => {
    if (mark === '*') return `${pre}**${inner}**`;
    if (mark === '_') return `${pre}*${inner}*`;
    return `${pre}~~${inner}~~`;
  });
}

export function isChecklistLine(line: string): boolean {
  return /=\s*\d/.test(line);
}

export function isHeaderLine(line: string): boolean {
  const t = line.trim();
  return t !== '' && !t.includes('=') && /[:-]$/.test(t);
}

// Membersihkan satu baris: awalan WhatsApp, tab/spasi ganda, penanda butir.
function cleanLine_(raw: string): string {
  let s = stripWhatsappPrefix(raw.replace(/\t/g, ' ').trim());
  s = s.replace(/ {2,}/g, ' ').trim();
  s = s.replace(LIST_MARKER, '');
  s = s.replace(CHECKBOX_MARKER, '');
  return s.trim();
}

function cleanLines_(raw: string): string[] {
  return raw
    .split(/\r\n|\r|\n/)
    .map(cleanLine_)
    .filter((l) => l !== '');
}

// Butir berurutan rapat; paragraf dan blok checklist dipisah satu baris kosong.
function linesToNote_(lines: string[]): string {
  const blocks: string[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length > 0) blocks.push(items.join('\n'));
    items = [];
  };
  for (const line of lines) {
    const text = convertWhatsappFormatting(line);
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
  return linesToNote_(cleanLines_(raw));
}

export function splitWhatsappBatch(raw: string): ParsedHandoverTask[] {
  const groups: { customerSuggestion: string; lines: string[] }[] = [];
  let current: { customerSuggestion: string; lines: string[] } | null = null;
  for (const line of cleanLines_(raw)) {
    if (isHeaderLine(line)) {
      current = { customerSuggestion: line.replace(/[:\-\s]+$/, '').trim(), lines: [] };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { customerSuggestion: '', lines: [] };
      groups.push(current);
    }
    current.lines.push(line);
  }
  return groups
    .map((g) => ({ customerSuggestion: g.customerSuggestion, note: linesToNote_(g.lines) }))
    .filter((t) => t.note !== '');
}
