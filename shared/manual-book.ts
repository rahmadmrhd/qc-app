/**
 * Nama otomatis Manual Book dari tipe item (tahap 4a, spek 2026-11-10 §2 butir 6 dan §3 butir 17). Murni: hanya
 * teks tipe item yang dipakai (merk dan BU tidak ikut).
 */

const DELIMITERS = new Set([' ', '-']);

function isDelimiter(char: string | undefined): boolean {
  return char !== undefined && DELIMITERS.has(char);
}

/**
 * Panjang awalan bersama terpanjang yang jatuh pada batas token (spasi atau `-`): pada tiap tipe, titik potong `p`
 * harus di ujung teks, tepat setelah pembatas, atau tepat sebelum pembatas. Titik 0 selalu sah (tanpa awalan).
 */
function commonPrefixLength(types: readonly string[]): number {
  const first = types[0] as string;
  let common = 0;
  while (common < first.length && types.every((type) => type[common] === first[common])) {
    common += 1;
  }
  for (let cut = common; cut > 0; cut -= 1) {
    const valid = types.every(
      (type) => cut === type.length || isDelimiter(type[cut - 1]) || isDelimiter(type[cut]),
    );
    if (valid) return cut;
  }
  return 0;
}

/** Memotong ke `max` karakter tanpa meninggalkan kurung terbuka atau pemisah `/` menggantung. */
function truncateName(name: string, max: number): string {
  if (name.length <= max) return name;
  let cut = name.slice(0, max);
  if (cut.lastIndexOf('(') > cut.lastIndexOf(')')) cut = cut.slice(0, cut.lastIndexOf('('));
  return cut.replace(/[\s/]+$/, '');
}

/**
 * Nama Manual Book dari tipe item: bagian awal yang sama ditulis sekali, bagian yang beda digabung dengan garis
 * miring ("PBE M5-400" + "PBE M5-200" -> "PBE M5-400/200"). Bila satu tipe adalah awalan tipe lain, sisa tipe yang
 * lebih panjang ditulis dalam kurung ("U6-XG" + "U6-XG-B" -> "U6-XG(-B)"). Tanpa awalan bersama, tipe digabung penuh.
 * Urutan masukan dipertahankan (duplikat dan teks kosong dibuang); hasil dipotong ke `max` karakter.
 */
export function manualBookNameFromTypes(types: readonly string[], max = 60): string {
  const unique: string[] = [];
  for (const raw of types) {
    const type = raw.trim();
    if (type !== '' && !unique.includes(type)) unique.push(type);
  }
  if (unique.length === 0) return '';
  if (unique.length === 1) return truncateName(unique[0] as string, max);

  const length = commonPrefixLength(unique);
  const prefix = (unique[0] as string).slice(0, length);
  const rests = unique.map((type) => type.slice(length));
  const hasWholePrefix = rests.some((rest) => rest === '');
  let name: string;
  if (length > 0 && hasWholePrefix) {
    const others = rests.filter((rest) => rest !== '').map((rest) => rest.trim());
    name = `${prefix}(${others.join('/')})`;
  } else {
    name = `${prefix}${rests.join('/')}`;
  }
  return truncateName(name, max);
}
