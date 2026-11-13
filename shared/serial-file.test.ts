import { describe, expect, test } from 'bun:test';
import {
  parseQcsn,
  QCSN_FORMAT,
  QCSN_MAX_BYTES,
  QCSN_MAX_ROWS,
  QCSN_VERSION,
  type QcsnRow,
  qcsnCanonical,
} from './serial-file';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: 'c0ffee00-1111-2222-3333-444455556666',
    serial: '4c:5e:0c:1a:2b:3d',
    testDate: '2026-11-12',
    itemId: 'item-1',
    itemLabel: 'Merk A Tipe 1',
    buId: 'bu-1',
    buLabel: 'BU Satu',
    locationId: 'loc-1',
    locationLabel: 'Gudang',
    sample: false,
    note: '',
    status: 'good',
    source: 'manual',
    capturedAt: '2026-11-12T10:00:00+07:00',
    ...overrides,
  };
}

function file(rows: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: QCSN_FORMAT,
    version: QCSN_VERSION,
    exportedAt: '2026-11-12T10:05:00+07:00',
    app: { name: 'qc-web', version: '1.0.0' },
    rows,
    checksum: 'sha256:abc',
    ...overrides,
  });
}

describe('parseQcsn tingkat berkas', () => {
  test('berkas sah: serial dinormalisasi', () => {
    const result = parseQcsn(file([row()]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.problems).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.serial).toBe('4C5E0C1A2B3D');
    expect(result.file.checksum).toBe('sha256:abc');
  });

  test('terlalu besar, format salah, versi baru, terlalu banyak baris, JSON rusak', () => {
    expect(parseQcsn(' '.repeat(QCSN_MAX_BYTES + 1)).ok).toBe(false);
    expect(parseQcsn(file([], { format: 'lain' })).ok).toBe(false);
    const newer = parseQcsn(file([], { version: 2 }));
    expect(newer.ok).toBe(false);
    if (!newer.ok) expect(newer.message).toContain('versi lebih baru');
    const many = parseQcsn(file(Array.from({ length: QCSN_MAX_ROWS + 1 }, () => row())));
    expect(many.ok).toBe(false);
    expect(parseQcsn('{rusak').ok).toBe(false);
    expect(parseQcsn('null').ok).toBe(false);
    expect(parseQcsn('[]').ok).toBe(false);
    expect(parseQcsn(file([], { checksum: 5 })).ok).toBe(false);
  });

  test('ukuran dihitung dalam byte UTF-8', () => {
    const text = JSON.stringify({ x: 'é'.repeat(QCSN_MAX_BYTES / 2 + 10) });
    expect(parseQcsn(text).ok).toBe(false);
  });
});

describe('parseQcsn tingkat baris', () => {
  test('kunci __proto__ dan kunci tak dikenal diabaikan tanpa polusi', () => {
    const text = file([row()]).replace(
      '"sample"',
      '"__proto__":{"polluted":true},"extra":1,"sample"',
    );
    const result = parseQcsn(text);
    expect(result.ok).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(Object.keys(result.rows[0] as object)).not.toContain('extra');
    expect(Object.keys(result.rows[0] as object)).not.toContain('__proto__');
  });

  test('baris bermasalah masuk problems dengan nomor baris (mulai 1) dan keluar dari rows', () => {
    const bad: unknown[] = [
      row({ clientId: 'aaaaaaaa-0000-0000-0000-000000000001', note: 'a\u0000b' }),
      row({ clientId: 'aaaaaaaa-0000-0000-0000-000000000002', serial: 'AB‮C' }),
      row({ clientId: 'aaaaaaaa-0000-0000-0000-000000000003', sample: 'ya' }),
      row({ clientId: 'aaaaaaaa-0000-0000-0000-000000000004', testDate: '2026-02-30' }),
      row({ clientId: 'pendek' }),
      row({
        clientId: 'aaaaaaaa-0000-0000-0000-000000000006',
        stickers: [{ stickerId: 's', stickerLabel: 'S', qty: 100 }],
      }),
      row({
        clientId: 'aaaaaaaa-0000-0000-0000-000000000007',
        stickers: [{ stickerId: 's', stickerLabel: 'S', qty: 0 }],
      }),
      row({ clientId: 'aaaaaaaa-0000-0000-0000-000000000008', status: 'failed' }),
      row({ clientId: 'aaaaaaaa-0000-0000-0000-000000000009', source: 'lain' }),
      row({ clientId: 'aaaaaaaa-0000-0000-0000-000000000010', itemLabel: 'x'.repeat(256) }),
      'bukan objek',
    ];
    const result = parseQcsn(file([row(), ...bad]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.problems.map((p) => p.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  test('clientId kembar: baris kedua bermasalah', () => {
    const result = parseQcsn(file([row(), row({ serial: 'ZZ9' })]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.row).toBe(2);
  });

  test('stiker melebihi batas server (20) atau kembar: baris bermasalah, baris lain tetap', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      stickerId: `s${i}`,
      stickerLabel: `S${i}`,
      qty: 1,
    }));
    const twenty = many.slice(0, 20);
    const result = parseQcsn(
      file([
        row({ clientId: 'aaaaaaaa-0000-0000-0000-000000000001', stickers: twenty }),
        row({ clientId: 'aaaaaaaa-0000-0000-0000-000000000002', stickers: many }),
        row({
          clientId: 'aaaaaaaa-0000-0000-0000-000000000003',
          stickers: [
            { stickerId: 's1', stickerLabel: 'Stiker', qty: 1 },
            { stickerId: 's1', stickerLabel: 'Stiker', qty: 2 },
          ],
        }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.problems.map((p) => p.row)).toEqual([2, 3]);
    expect(result.problems[1]?.message).toContain('kembar');
  });

  test('stiker, reinjectedAt, dan buId opsional diterima', () => {
    const result = parseQcsn(
      file([
        row({
          buId: undefined,
          buLabel: undefined,
          reinjectedAt: '2026-11-12T11:00:00+07:00',
          stickers: [{ stickerId: 's1', stickerLabel: 'Stiker', qty: 3 }],
        }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.problems).toEqual([]);
    expect(result.rows[0]?.buId).toBe('');
    expect(result.rows[0]?.reinjectedAt).toBe('2026-11-12T11:00:00+07:00');
    expect(result.rows[0]?.stickers).toEqual([{ stickerId: 's1', stickerLabel: 'Stiker', qty: 3 }]);
  });
});

describe('qcsnCanonical', () => {
  test('stabil terhadap urutan kunci masukan dan mengabaikan kunci asing', () => {
    const a = parseQcsn(file([row()]));
    const reversed = Object.fromEntries(Object.entries(row()).reverse());
    const b = parseQcsn(file([{ ...reversed, extra: 1 }]));
    if (!a.ok || !b.ok) throw new Error('berkas harus sah');
    expect(qcsnCanonical(a.rows)).toBe(qcsnCanonical(b.rows));
    const changed = { ...(a.rows[0] as QcsnRow), note: 'lain' };
    expect(qcsnCanonical([changed])).not.toBe(qcsnCanonical(a.rows));
  });
});

describe('baris berstatus selain good (laporan rusak)', () => {
  const id = (n: number) => `bbbbbbbb-0000-0000-0000-${String(n).padStart(12, '0')}`;

  test('failed, broken, dan status lain ditolak sebagai bermasalah; kunci damage diabaikan', () => {
    const result = parseQcsn(
      file([
        row({ clientId: id(1), status: 'failed', damage: 'Layar retak' }),
        row({ clientId: id(2), status: 'reported' }),
        row({ clientId: id(3), status: 'broken' }),
        row({ clientId: id(4), status: 'good', damage: 'abaikan' }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.clientId).toBe(id(4));
    expect((result.rows[0] as unknown as Record<string, unknown>).damage).toBeUndefined();
    expect(result.problems.map((p) => p.row)).toEqual([1, 2, 3]);
  });

  test('bentuk kanonis tidak lagi memuat damage', () => {
    const parsed = parseQcsn(file([row({ clientId: id(11) })]));
    if (!parsed.ok) throw new Error('berkas seharusnya sah');
    const canonical = JSON.parse(qcsnCanonical(parsed.rows as QcsnRow[])) as Record<
      string,
      unknown
    >[];
    expect('damage' in (canonical[0] ?? {})).toBe(false);
    expect(canonical[0]?.status).toBe('good');
  });
});
