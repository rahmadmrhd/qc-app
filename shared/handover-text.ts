// Bentuk kanonis teks catatan Serah Terima. Murni.
// Catatan bisa tersimpan sebagai Markdown mentah (jalur bulk) atau hasil serializer editor (escape backslash
// dan entitas HTML). Pencocokan centang dan jangkar komentar membandingkan bentuk kanonisnya, bukan teks
// tersimpan, supaya kedua bentuk itu dianggap sama.

const HANDOVER_NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

// Escape backslash Markdown (CommonMark: tanda baca ASCII dapat di-escape).
const HANDOVER_MD_ESCAPE = /\\([\\`*_{}[\]()#+\-.!~>|<&:;="'$%^,/?@])/g;
const HANDOVER_NEEDS_SPACE_FOLD = /[^\S ]| {2}/;
const HANDOVER_ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g;

function handoverDecodeEntity_(
  all: string,
  dec: string | undefined,
  hex: string | undefined,
  name: string | undefined,
): string {
  if (name !== undefined) return HANDOVER_NAMED_ENTITIES[name] ?? all;
  const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? '', 16);
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return all;
  if (code === 0xa0) return ' ';
  return String.fromCodePoint(code);
}

/** Membuang escape backslash Markdown dan mendekode entitas HTML (nbsp menjadi spasi biasa). */
export function handoverUnescapeText(text: string): string {
  return text
    .replace(HANDOVER_MD_ESCAPE, '$1')
    .replace(HANDOVER_ENTITY, (all, dec, hex, name) =>
      handoverDecodeEntity_(all, dec as string | undefined, hex as string | undefined, name),
    );
}

/** Bentuk kanonis: tanpa escape/entitas, spasi (termasuk nbsp) dirapikan menjadi satu dan dipangkas. */
export function handoverCanonicalText(text: string): string {
  // Jalur cepat (kasus umum): tanpa backslash/entitas dan tanpa spasi selain satu spasi biasa.
  if (
    text.indexOf(String.fromCharCode(92)) === -1 &&
    text.indexOf('&') === -1 &&
    !HANDOVER_NEEDS_SPACE_FOLD.test(text)
  ) {
    return text.trim();
  }
  return handoverUnescapeText(text).replace(/\s+/g, ' ').trim();
}
