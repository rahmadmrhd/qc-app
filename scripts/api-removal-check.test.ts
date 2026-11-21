import { describe, expect, test } from 'bun:test';
import type { SnapshotEntry } from '../shared/api-snapshot';
import type { RetiredRoute } from '../shared/api-versions';
import { runRemovalCheck } from './api-removal-check';

const HOUR = 60 * 60 * 1000;
const PREVIOUS: SnapshotEntry[] = [{ id: 'a.old', verb: 'GET', path: '/a', deprecated: true }];
const RETIRED: RetiredRoute[] = [
  { id: 'a.old', verb: 'GET', path: '/a', removedIn: 'server-v1.4.0' },
];

function run(argv: string[], readFile: (path: string) => string = () => JSON.stringify(PREVIOUS)) {
  const errors: string[] = [];
  const code = runRemovalCheck(argv, readFile, [], RETIRED, (line) => errors.push(line));
  return { code, errors: errors.join('\n') };
}

describe('runRemovalCheck', () => {
  test('rute dihapus, tag berumur 30 jam: lolos', () => {
    expect(run(['/tmp/prev.json', String(30 * HOUR)]).code).toBe(0);
  });

  test('rute dihapus, tag berumur 5 jam: gagal dan pesannya menyebut 24 jam', () => {
    const result = run(['/tmp/prev.json', String(5 * HOUR)]);
    expect(result.code).toBe(1);
    expect(result.errors).toContain('24 jam');
    expect(result.errors).toContain('a.old');
  });

  test('umur none (belum ada rilis sebelumnya): lolos', () => {
    expect(run(['/tmp/prev.json', 'none']).code).toBe(0);
  });

  test('berkas potret tak terbaca: gagal dengan pesan jelas', () => {
    const result = run(['/tmp/hilang.json', 'none'], () => {
      throw new Error('ENOENT');
    });
    expect(result.code).toBe(1);
    expect(result.errors).toMatch(/potret.*tak terbaca/i);
  });

  test('isi potret bukan JSON array: gagal dengan pesan jelas', () => {
    for (const body of ['{ rusak', '{"id":"a"}', '"teks"']) {
      const result = run(['/tmp/prev.json', 'none'], () => body);
      expect(result.code).toBe(1);
      expect(result.errors).toMatch(/potret/i);
    }
  });

  test('argumen salah: gagal dengan petunjuk pemakaian', () => {
    const bad = [
      [],
      ['/tmp/prev.json'],
      ['/tmp/prev.json', '1', '2'],
      ['/tmp/prev.json', 'besok'],
      ['/tmp/prev.json', '-5'],
      ['/tmp/prev.json', '1.5'],
    ];
    for (const argv of bad) {
      const result = run(argv);
      expect(result.code).toBe(1);
      expect(result.errors).toMatch(/pemakaian|umur/i);
    }
  });
});
