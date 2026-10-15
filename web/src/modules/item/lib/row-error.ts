/**
 * Nomor baris (0-based) dari pesan galat berbentuk "<Awalan> N: ..." (mis. "Stiker 3: nama wajib diisi"),
 * atau `null` bila pesan bukan galat baris. Dipakai untuk menandai input yang bermasalah (`aria-invalid`).
 */
export function rowOfError(message: string | undefined, prefix: string): number | null {
  if (!message?.startsWith(`${prefix} `)) return null;
  const number = Number.parseInt(message.slice(prefix.length + 1), 10);
  return Number.isInteger(number) && number >= 1 ? number - 1 : null;
}

/** Pesan pertama dari daftar galat (teks atau objek berpesan, mis. dari zod); `undefined` bila tak ada. */
export function errorText(errors: ReadonlyArray<unknown>): string | undefined {
  for (const error of errors) {
    if (typeof error === 'string' && error !== '') return error;
    if (error && typeof error === 'object' && 'message' in error) {
      const message = String((error as { message: unknown }).message);
      if (message !== '') return message;
    }
  }
  return undefined;
}
