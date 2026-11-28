import type { ImportClInput, ImportClResult } from '@shared/contract';

/** Batas per panggilan (server menolak JSON > 900.000 byte dan maks. 399 skrip); dipecah di bawahnya agar longgar. */
const MAX_PART_BYTES = 700_000;
const MAX_PART_SCRIPTS = 100;
const encoder = new TextEncoder();

function bytesOf(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/**
 * Memecah permintaan impor besar menjadi beberapa panggilan `clImport.run` (tiap ~700 KB JSON atau 100 skrip). Pengaturan
 * dikirim di SETIAP panggilan (idempoten: dilewati bila sama); firmware HANYA di panggilan terakhir, karena mengaitkan
 * firmware ke skrip butuh skripnya sudah ada di server. Urutan skrip terjaga.
 */
export function splitImport(input: ImportClInput): ImportClInput[] {
  const base = bytesOf({ settings: input.settings, scripts: [], firmwares: [] });
  const parts: ImportClInput['scripts'][] = [];
  let current: ImportClInput['scripts'] = [];
  let size = base;
  for (const script of input.scripts) {
    // +1 untuk koma pemisah elemen larik.
    const cost = bytesOf(script) + 1;
    if (
      current.length > 0 &&
      (current.length >= MAX_PART_SCRIPTS || size + cost > MAX_PART_BYTES)
    ) {
      parts.push(current);
      current = [];
      size = base;
    }
    current.push(script);
    size += cost;
  }
  parts.push(current);
  const lastIndex = parts.length - 1;
  return parts.map((scripts, index) => ({
    settings: input.settings,
    scripts,
    firmwares: index === lastIndex ? input.firmwares : [],
  }));
}

/** Laporan gabungan dari semua panggilan impor. */
export function mergeImportResults(results: readonly ImportClResult[]): ImportClResult {
  return {
    filesCreated: results.reduce((sum, result) => sum + result.filesCreated, 0),
    filesSkipped: results.reduce((sum, result) => sum + result.filesSkipped, 0),
    firmwaresLinked: results.reduce((sum, result) => sum + result.firmwaresLinked, 0),
    issues: results.flatMap((result) => result.issues),
  };
}
