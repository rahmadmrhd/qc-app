// biome-ignore-all lint/suspicious/noTemplateCurlyInString: sumber SQL sintetis memuat `${...}` sebagai teks
// Tes penjaga soft delete (rancangan `docs/superpowers/specs/2026-11-20-soft-delete-design.md` §4.2 dan §5 butir 15):
// setiap `FROM`/`JOIN` ke tabel ber-soft-delete di literal SQL server harus menyaring record terhapus (`deleted_at`,
// `liveWhere`/`deletedWhere`), atau tercantum di `SOFT_DELETE_PENDING` (pekerjaan fase berikutnya) /
// `SOFT_DELETE_EXEMPT` (sah tanpa penyaring). Entri yang tak lagi cocok = "entri basi".
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SOFT_DELETE_EXEMPT, SOFT_DELETE_PENDING } from './soft-delete-pending';
import { scanSource } from './soft-delete-scan';

const ROOT = join(import.meta.dir, '..', '..', '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'node_modules' || name === 'test-support') continue;
      out.push(...sourceFiles(path));
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(path);
  }
  return out.sort();
}

const relPath = (file: string) => relative(ROOT, file).split('\\').join('/');

describe('pemindai (kasus sintetis)', () => {
  const bad = (source: string) => scanSource(source).filter((ref) => !ref.ok);

  test('FROM tanpa penyaring dilaporkan; dengan liveWhere() tidak', () => {
    expect(bad('const q = "SELECT * FROM items WHERE id = ?"').map((r) => r.table)).toEqual([
      'items',
    ]);
    expect(bad('const q = `SELECT * FROM items WHERE ${liveWhere()}`')).toEqual([]);
    expect(bad("const q = 'SELECT * FROM items WHERE deleted_at = \\'\\''")).toEqual([]);
    expect(bad("const q = `SELECT * FROM items i WHERE ${liveWhere('i')}`")).toEqual([]);
    expect(bad('const q = `SELECT * FROM items WHERE ${deletedWhere()}`')).toEqual([]);
  });

  test('fragmen FROM tersusun dihitung sebagai kemunculan kedua tabel', () => {
    const tables = bad(
      "export const HANDOVER_FROM = 'handovers h LEFT JOIN customers c ON c.id = h.customer_id';",
    ).map((r) => r.table);
    expect(tables).toEqual(['handovers', 'customers']);
  });

  test('penyaringan dinilai per alias: h.deleted_at tidak meloloskan c', () => {
    const refs = bad(
      "const q = `SELECT 1 FROM handovers h JOIN customers c ON c.id = h.customer_id WHERE h.deleted_at = ''`;",
    );
    expect(refs.map((r) => r.table)).toEqual(['customers']);
  });

  test('deleted_at tak berkualifikasi tidak meloloskan literal multi-tabel', () => {
    const refs = bad(
      "const q = `SELECT 1 FROM handovers h JOIN customers c ON c.id = h.customer_id WHERE deleted_at = ''`;",
    );
    expect(refs.map((r) => r.table)).toEqual(['handovers', 'customers']);
  });

  test('tabel anak tanpa induk dilaporkan; dengan JOIN induk tersaring lolos', () => {
    expect(
      bad('const q = "FROM serial_events e WHERE e.serial_id = ?"').map((r) => r.table),
    ).toEqual(['serial_events']);
    expect(
      bad(
        'const q = "FROM serial_events e JOIN serials s ON s.id = e.serial_id AND s.deleted_at = \'\'"',
      ),
    ).toEqual([]);
    // induk ada tetapi tidak tersaring: induk dan anak sama-sama dilaporkan
    expect(
      bad('const q = "FROM serial_events e JOIN serials s ON s.id = e.serial_id"').map(
        (r) => r.table,
      ),
    ).toEqual(['serial_events', 'serials']);
  });

  test('notifications lolos bila salah satu induknya (handovers/serials) tersaring', () => {
    expect(
      bad(
        'const q = "FROM notifications n JOIN handovers h ON h.id = n.handover_id WHERE h.deleted_at = \'\'"',
      ),
    ).toEqual([]);
  });

  test('UPDATE, DELETE, dan EXISTS di luar cakupan; komentar dan teks bukan SQL diabaikan', () => {
    expect(bad('const q = "UPDATE items SET a = 1 WHERE id IN (SELECT id FROM items)"')).toEqual(
      [],
    );
    expect(bad('const q = "DELETE FROM items WHERE id = ?"')).toEqual([]);
    expect(
      bad(
        'const q = "SELECT 1 FROM brands b WHERE b.deleted_at = \'\' AND EXISTS (SELECT 1 FROM items i)"',
      ),
    ).toEqual([]);
    expect(bad('// FROM items WHERE x\nconst a = 1;')).toEqual([]);
    expect(bad("const m = 'dari items ke brands';")).toEqual([]);
  });

  test('nomor urut menghitung semua kemunculan tabel di berkas', () => {
    const refs = scanSource(
      "a(`FROM items WHERE ${liveWhere()}`);\nb('SELECT 1 FROM items WHERE id = ?');",
    );
    expect(refs.map((r) => [r.key, r.ok, r.line])).toEqual([
      ['items@1', true, 1],
      ['items@2', false, 2],
    ]);
  });

  test('literal template dengan interpolasi bersarang dibaca utuh', () => {
    const refs = scanSource(
      "const q = `SELECT ${ids.map((x) => `'${x}'`).join(',')} FROM items WHERE id = ?`;",
    );
    expect(refs.map((r) => [r.table, r.ok])).toEqual([['items', false]]);
  });
});

describe('kode server', () => {
  const files = [
    ...sourceFiles(join(ROOT, 'server', 'src')),
    ...sourceFiles(join(ROOT, 'server', 'scripts')),
  ];
  const scanned = new Map(
    files.map((file) => [relPath(file), scanSource(readFileSync(file, 'utf8'))] as const),
  );

  test('setiap FROM/JOIN ke tabel ber-soft-delete menyaring, atau tercantum di PENDING/EXEMPT', () => {
    const problems: string[] = [];
    for (const [file, refs] of scanned) {
      const allowed = new Set([
        ...(SOFT_DELETE_PENDING[file] ?? []),
        ...Object.keys(SOFT_DELETE_EXEMPT)
          .filter((key) => key.startsWith(`${file}#`))
          .map((key) => key.slice(file.length + 1)),
      ]);
      for (const ref of refs) {
        if (!ref.ok && !allowed.has(ref.key)) {
          problems.push(
            `${file}:${ref.line} FROM ${ref.table} tanpa penyaring (kunci "${ref.key}")`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test('tidak ada entri PENDING/EXEMPT yang basi', () => {
    const stale: string[] = [];
    const violating = (file: string) =>
      new Set((scanned.get(file) ?? []).filter((ref) => !ref.ok).map((ref) => ref.key));
    for (const [file, keys] of Object.entries(SOFT_DELETE_PENDING)) {
      if (!scanned.has(file)) {
        stale.push(`${file} (berkas tidak ada)`);
        continue;
      }
      const now = violating(file);
      for (const key of keys) if (!now.has(key)) stale.push(`${file} ${key} (entri basi)`);
    }
    for (const key of Object.keys(SOFT_DELETE_EXEMPT)) {
      const [file, ref] = key.split('#') as [string, string];
      if (!violating(file).has(ref)) stale.push(`${key} (entri basi)`);
    }
    expect(stale).toEqual([]);
  });

  test('entri PENDING tidak ganda dan EXEMPT punya alasan', () => {
    for (const [file, keys] of Object.entries(SOFT_DELETE_PENDING)) {
      expect(new Set(keys).size, file).toBe(keys.length);
    }
    for (const [key, reason] of Object.entries(SOFT_DELETE_EXEMPT)) {
      expect(reason.trim(), key).not.toBe('');
    }
  });
});
