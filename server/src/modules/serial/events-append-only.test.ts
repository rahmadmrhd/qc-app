import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';

/**
 * Riwayat Serial Number hanya bertambah (spek §13): kesalahan dikoreksi dengan kejadian baru, bukan dengan menyunting
 * atau menghapus yang lama. Tes statis ini memindai SEMUA kode produksi di `server/src` (selain berkas tes) dan
 * menggagalkan build bila ada SQL yang mengubah atau membuang baris `serial_events`.
 */
const FORBIDDEN: readonly { name: string; pattern: RegExp }[] = [
  { name: 'UPDATE serial_events', pattern: /\bUPDATE\s+`?serial_events\b/i },
  { name: 'DELETE FROM serial_events', pattern: /\bDELETE\s+FROM\s+`?serial_events\b/i },
  { name: 'REPLACE INTO serial_events', pattern: /\bREPLACE\s+INTO\s+`?serial_events\b/i },
  { name: 'TRUNCATE serial_events', pattern: /\bTRUNCATE\s+(?:TABLE\s+)?`?serial_events\b/i },
  {
    name: 'INSERT serial_events ... ON DUPLICATE KEY UPDATE',
    pattern:
      /\bINSERT\s+(?:IGNORE\s+)?INTO\s+`?serial_events\b[^;]*?ON\s+DUPLICATE\s+KEY\s+UPDATE/is,
  },
  // JOIN pada UPDATE/DELETE multi-tabel: `UPDATE serials s JOIN serial_events e ...` juga mengubahnya.
  {
    name: 'UPDATE ... JOIN serial_events',
    pattern: /\bUPDATE\b[^;]*?\bJOIN\s+`?serial_events\b/is,
  },
  {
    name: 'DELETE ... JOIN serial_events',
    pattern: /\bDELETE\b[^;]*?\bJOIN\s+`?serial_events\b/is,
  },
];

const SRC = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

async function productionSources(): Promise<string[]> {
  const files: string[] = [];
  for await (const file of new Glob('**/*.ts').scan({ cwd: SRC, absolute: true })) {
    if (file.endsWith('.test.ts')) continue;
    files.push(file);
  }
  return files;
}

describe('serial_events hanya bertambah', () => {
  test('tak ada UPDATE, DELETE, REPLACE, atau TRUNCATE pada serial_events di server/src', async () => {
    const files = await productionSources();
    expect(files.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const file of files) {
      const text = await Bun.file(file).text();
      for (const { name, pattern } of FORBIDDEN) {
        if (pattern.test(text)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('pemindai benar-benar menangkap pola terlarang (kontrol positif)', () => {
    const samples = [
      'UPDATE serial_events SET message = ?',
      'delete from `serial_events` where id = ?',
      'REPLACE INTO serial_events (id) VALUES (?)',
      'INSERT INTO serial_events (id) VALUES (?) ON DUPLICATE KEY UPDATE message = ?',
      'UPDATE serials s JOIN serial_events e ON e.serial_id = s.id SET e.message = ?',
    ];
    for (const sample of samples) {
      expect(FORBIDDEN.some(({ pattern }) => pattern.test(sample))).toBe(true);
    }
    expect(
      FORBIDDEN.some(({ pattern }) =>
        pattern.test('INSERT INTO serial_events (id) SELECT ? FROM serials WHERE id = ?'),
      ),
    ).toBe(false);
  });
});
