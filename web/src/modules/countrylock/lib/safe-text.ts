// Teks dari jembatan desktop (progres, pesan hasil, galat) berasal dari shell perangkat dan tidak
// dipercaya: selalu dirender sebagai TEKS React (bukan HTML), dan kata sandi disamarkan sekali
// lagi di sini sebagai pertahanan berlapis (proses utama sudah membuang ANSI dan menyamarkannya).

export const MAX_LOG_LINES = 500;
export const MAX_LINE_CHARS = 500;
/** Kata sandi lebih pendek dari ini tidak disamarkan di renderer (akan merusak teks biasa). */
const MIN_MASK_LENGTH = 3;

/** Ada karakter kontrol (C0, DEL, C1)? Cermin `hasControlChars` kontrak jembatan tanpa menarik zod. */
export function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Mengganti setiap kemunculan kata sandi (yang cukup panjang) dengan `***`. */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length >= MIN_MASK_LENGTH) out = out.split(secret).join('***');
  }
  return out;
}

/** Membuang karakter kontrol, menyamarkan kata sandi, lalu memangkas panjang. */
export function safeLine(text: string, secrets: readonly string[]): string {
  let clean = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    clean += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : char;
  }
  const masked = maskSecrets(clean, secrets);
  return masked.length > MAX_LINE_CHARS ? `${masked.slice(0, MAX_LINE_CHARS)}...` : masked;
}

/** Menambah satu baris log dan menjaga jumlah baris tetap terbatas (baris tertua dibuang). */
export function appendLog(log: readonly string[], line: string): string[] {
  const next = [...log, line];
  return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
}

/** Tanggal lokal `YYYY-MM-DD` (catatan pending memakai hari lokal tanpa jam). */
export function localDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Pesan galat tak terduga yang aman ditampilkan (tanpa kata sandi dan tanpa data mentah). */
export function safeErrorMessage(error: unknown, secrets: readonly string[]): string {
  const message = error instanceof Error ? error.message : '';
  return message === '' ? 'Terjadi galat tak terduga' : safeLine(message, secrets);
}

/**
 * Galat kredensial (aturan lama, spek §7): pesan memuat "Permission denied" atau "username" meminta
 * kredensial baru; galat jaringan lain tidak. Proses utama melapor "Perangkat menolak kredensial".
 */
export function isCredentialFailure(message: string): boolean {
  return /permission denied|username|menolak kredensial/i.test(message);
}
