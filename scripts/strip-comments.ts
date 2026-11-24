// Pembuang komentar bersama untuk penjaga sumber web (`no-native-file-input`, `no-native-select`, `no-raw-palette`,
// `no-legacy-variants`, `mobile-navigation-guard`, `page-frame`). Memakai tokenizer `stripSource` (sadar string, template, dan
// regex): `/*` di dalam string seperti `'image/*'` tidak lagi dianggap awal komentar yang menyembunyikan kode sesudahnya dari
// SEMUA penjaga. Isi string dipertahankan (penjaga memeriksa nilai kelas dan atribut). Nomor baris tetap sama.
import { stripSource } from './raw-rm-scan';

/** Hasil per teks sumber: keenam penjaga memindai berkas yang sama, jadi tokenizer (lebih lambat dari regex) cukup sekali. */
const cache = new Map<string, string>();

export function stripComments(source: string): string {
  const hit = cache.get(source);
  if (hit !== undefined) return hit;
  const result = stripSource(source, false);
  cache.set(source, result);
  return result;
}
