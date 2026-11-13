// Pembersihan teks bebas dari karakter kontrol. Murni, tanpa impor, dipakai bersama oleh Postel dan notifikasi.

/** Karakter kontrol (C0, DEL, C1 NEL), pemisah baris/paragraf Unicode, dan pengatur arah teks (bidi). */
function isControlOrBidi(code: number): boolean {
  return (
    code <= 0x1f ||
    code === 0x7f ||
    (code >= 0x80 && code <= 0x9f) ||
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/** Apakah `text` memuat karakter kontrol, pemisah baris, atau pengatur arah teks. */
export function hasControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (isControlOrBidi(text.charCodeAt(i))) return true;
  return false;
}

/** `text` dengan tiap karakter kontrol/pemisah baris/bidi diganti spasi, spasi beruntun dipadatkan, lalu dipangkas. */
export function stripControlChars(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += isControlOrBidi(text.charCodeAt(i)) ? ' ' : text.charAt(i);
  }
  return result.replace(/ {2,}/g, ' ').trim();
}
