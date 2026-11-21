// Pagar rilis server untuk kontrak API (fase 3 versi API; rancangan docs/superpowers/specs/2026-11-20-versi-api-fase3-design.md
// bagian 5b): menolak rilis yang menghapus rute API padahal rilis yang menandainya deprecated baru terbit kurang dari 24 jam,
// atau yang melanggar kompatibilitas mundur (rute hilang tanpa RETIRED_ROUTES, verb/path/query berubah).
//
//   bun run scripts/api-removal-check.ts <berkas-potret-sebelumnya> <umur-tag-ms|none>
//
// Dijalankan `release:prepare server` di pohon cabang rilis (isi `origin/dev`), jadi kontrak dan `RETIRED_ROUTES` yang
// dibandingkan milik `origin/dev`. `<berkas-potret-sebelumnya>` = potret kontrak pada tag server terakhir; `none` = belum
// ada rilis sebelumnya. Kode keluar 1 bila ada pelanggaran.
import { readFileSync } from 'node:fs';
import {
  contractSnapshot,
  REMOVAL_MIN_AGE_MS,
  removalProblems,
  type SnapshotEntry,
} from '../shared/api-snapshot';
import { RETIRED_ROUTES, type RetiredRoute } from '../shared/api-versions';

const USAGE =
  'Pemakaian: bun run scripts/api-removal-check.ts <berkas-potret-sebelumnya> <umur-tag-ms|none>';

/**
 * Isi pagar tanpa efek samping: berkas dibaca lewat `readFile`, kontrak sekarang dan `RETIRED_ROUTES` dapat disuntik
 * (bawaan: milik pohon kerja ini), dan pelanggaran dicetak lewat `printError`. Mengembalikan kode keluar.
 */
export function runRemovalCheck(
  argv: string[],
  readFile: (path: string) => string,
  current: SnapshotEntry[] = contractSnapshot(),
  retired: readonly RetiredRoute[] = RETIRED_ROUTES,
  printError: (line: string) => void = console.error,
): number {
  const [file, age, ...rest] = argv;
  if (file === undefined || age === undefined || rest.length > 0) {
    printError(USAGE);
    return 1;
  }
  let ageMs: number | null = null;
  if (age !== 'none') {
    if (!/^\d+$/.test(age)) {
      printError(`Umur tag "${age}" bukan angka milidetik bulat tak negatif atau "none". ${USAGE}`);
      return 1;
    }
    ageMs = Number(age);
  }
  let previous: SnapshotEntry[];
  try {
    const parsed: unknown = JSON.parse(readFile(file));
    if (!Array.isArray(parsed)) throw new Error('bukan JSON array');
    previous = parsed as SnapshotEntry[];
  } catch (error) {
    printError(
      `Potret kontrak sebelumnya (${file}) tak terbaca atau rusak: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  const problems = removalProblems({
    previous,
    current,
    retired,
    previousTagAgeMs: ageMs,
    minAgeMs: REMOVAL_MIN_AGE_MS,
  });
  for (const problem of problems) printError(problem);
  if (problems.length > 0) {
    printError(
      'Rilis ditolak. Tunggu sampai rilis yang menandai rute itu deprecated berumur 24 jam, atau kembalikan rutenya (dan hapus dari RETIRED_ROUTES).',
    );
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  process.exit(runRemovalCheck(process.argv.slice(2), (path) => readFileSync(path, 'utf8')));
}
