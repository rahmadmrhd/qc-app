// Membaca token katalog dari env build (`CATALOG_TOKEN`). Aturan sama dengan server (`DESKTOP_CATALOG_TOKEN`: minimal
// 32 karakter); karakter dibatasi agar aman di header HTTP. Kosong/tidak sah = `null` (katalog dinonaktifkan); build
// TIDAK gagal karena Country Lock harus tetap bisa dibangun tanpa katalog. Nilai tidak pernah dicetak.

export const CATALOG_TOKEN_MIN_LENGTH = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{32,512}$/;

export interface ResolvedCatalogToken {
  token: string | null;
  /** Alasan token tidak dipakai (tanpa nilai token), untuk log build. */
  problem: string | null;
}

export function resolveCatalogToken(
  env: Readonly<Record<string, string | undefined>>,
): ResolvedCatalogToken {
  const raw = env.CATALOG_TOKEN?.trim() ?? '';
  if (raw === '') return { token: null, problem: null };
  if (!TOKEN_PATTERN.test(raw)) {
    return {
      token: null,
      problem: `CATALOG_TOKEN diabaikan: minimal ${CATALOG_TOKEN_MIN_LENGTH} karakter dan hanya huruf, angka, atau . _ ~ + / = -`,
    };
  }
  return { token: raw, problem: null };
}
