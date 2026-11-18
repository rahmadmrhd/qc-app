// Konvensi migrasi `-- qc:contract` (rancangan docs/superpowers/specs/2026-11-17-rilis-semver-design.md bagian 5.5.1):
// migrasi yang MENGHAPUS atau MENGGANTI NAMA skema (fase "contract" dari expand -> contract) wajib memakai baris pertama
// `-- qc:contract`. Pagar downgrade skema (`deploy/deploy.sh` `schema_guard` di VPS dan `scripts/deploy-tag-check.ts` di CI)
// membaca penanda itu dari berkas migrasi di image yang SEDANG berjalan: migrasi berpenanda tak pernah boleh dilewati saat
// downgrade, bahkan dengan `allow-schema-downgrade`, karena image lama tak kompatibel dengan skema pasca-contract.
// Murni dan tanpa dependensi; satu definisi dipakai tes dan CLI CI.

// Pola destruktif (tanpa memperhatikan huruf; spasi/baris baru di antara kata dilonggarkan oleh \s+).
const DESTRUCTIVE = [
  /\bDROP\s+(COLUMN|TABLE|INDEX|CONSTRAINT|FOREIGN\s+KEY)\b/i,
  /\bRENAME\s+(COLUMN|TABLE|TO)\b/i,
  /\bCHANGE\s+COLUMN\b/i,
];

// Baris pertama persis `-- qc:contract`, boleh diikuti spasi/tab dan CR (berkas CRLF); tanpa spasi di depan, tanpa teks lain.
const MARKER = /^-- qc:contract[ \t]*\r?$/;

/** Buang komentar baris (`--`) dan komentar blok agar kata DROP di dalam komentar tidak dihitung. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
}

/** `sql` memuat pernyataan yang menghapus atau mengganti nama skema (komentar diabaikan). */
export function isDestructive(sql: string): boolean {
  const body = stripComments(sql);
  return DESTRUCTIVE.some((pattern) => pattern.test(body));
}

/** Baris PERTAMA `sql` persis `-- qc:contract` (boleh diikuti spasi). */
export function hasContractMarker(sql: string): boolean {
  const newline = sql.indexOf('\n');
  const first = newline === -1 ? sql : sql.slice(0, newline);
  return MARKER.test(first);
}

/** Nama migrasi (urut seperti masukan) yang berpenanda contract. */
export function listContractMigrations(names: string[], read: (name: string) => string): string[] {
  return names.filter((name) => hasContractMarker(read(name)));
}
