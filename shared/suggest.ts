import { normalizeKey } from './items';

/** Jarak Levenshtein; berhenti dini dan mengembalikan `max + 1` bila sudah pasti melebihi `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length] ?? max + 1;
}

const NO_MATCH = Number.POSITIVE_INFINITY;

/** Skor satu kata ketikan terhadap kata target: 0 tepat, 1 awalan, 2 typo ringan (kata >= 5 huruf); tidak cocok = tak hingga. */
function tokenScore(query: string, target: string): number {
  if (query === target) return 0;
  if (target.startsWith(query)) return 1;
  // Typo hanya ditoleransi untuk kata >= 5 huruf: kata pendek (mis. "es24" vs "s24") terlalu mudah salah cocok.
  if (query.length < 5) return NO_MATCH;
  const tolerance = query.length >= 7 ? 2 : 1;
  return editDistance(query, target, tolerance) <= tolerance ? 2 : NO_MATCH;
}

/**
 * Skor teks terhadap ketikan (lebih kecil lebih baik; `null` = tidak cocok). Semua kata ketikan harus cocok
 * dengan kata mana pun di teks (urutan bebas, typo ringan, awalan); bila tidak, ketikan tanpa spasi boleh
 * menjadi bagian dari teks tanpa spasi ("es24" ≈ "es 24").
 */
function textScore(queryTokens: readonly string[], text: string): number | null {
  const targetTokens = normalizeKey(text)
    .split(' ')
    .filter((token) => token !== '');
  let total = 0;
  let allMatched = true;
  for (const token of queryTokens) {
    let best = NO_MATCH;
    for (const target of targetTokens) best = Math.min(best, tokenScore(token, target));
    if (best === NO_MATCH) {
      allMatched = false;
      break;
    }
    total += best;
  }
  if (allMatched) return total;
  const compactQuery = queryTokens.join('');
  return compactQuery.length >= 3 && targetTokens.join('').includes(compactQuery) ? 3 : null;
}

/**
 * Saran dari daftar yang sudah dimuat (tanpa RPC per ketikan). `texts` memberi semua teks yang dicari
 * per baris (mis. merk, tipe, nama lain); semuanya digabung sehingga "galaxy samsung" menemukan
 * merk "Samsung" + tipe "Galaxy S24". Ketikan kosong tidak menghasilkan saran.
 */
export function suggestMatches<T>(
  items: readonly T[],
  query: string,
  texts: (item: T) => readonly string[],
  limit = 8,
): T[] {
  const queryTokens = normalizeKey(query)
    .split(' ')
    .filter((token) => token !== '');
  if (queryTokens.length === 0) return [];
  const scored: Array<{ item: T; score: number; index: number }> = [];
  items.forEach((item, index) => {
    const score = textScore(queryTokens, texts(item).join(' '));
    if (score !== null) scored.push({ item, score, index });
  });
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.slice(0, limit).map((entry) => entry.item);
}

function similarityThreshold(length: number): number {
  if (length <= 5) return 1;
  if (length <= 10) return 2;
  return 3;
}

/**
 * Nama yang MIRIP (bukan sama) dengan ketikan: kata sama dalam urutan berbeda, atau selisih ejaan kecil.
 * Nama dengan kunci ternormalisasi yang sama persis tidak dianggap mirip (itu orang yang sama).
 */
export function similarNames(query: string, names: readonly string[], limit = 3): string[] {
  const key = normalizeKey(query);
  if (key === '') return [];
  const sortedTokens = (text: string) => text.split(' ').sort().join(' ');
  const ranked: Array<{ name: string; distance: number }> = [];
  for (const name of names) {
    const other = normalizeKey(name);
    if (other === '' || other === key) continue;
    const reordered = sortedTokens(other) === sortedTokens(key);
    const threshold = similarityThreshold(Math.max(key.length, other.length));
    const distance = editDistance(key, other, threshold);
    if (reordered || distance <= threshold) {
      ranked.push({ name, distance: reordered ? 0 : distance });
    }
  }
  ranked.sort((a, b) => a.distance - b.distance);
  return ranked.slice(0, limit).map((entry) => entry.name);
}
