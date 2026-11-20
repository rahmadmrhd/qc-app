import { beforeEach, describe, expect, test } from 'bun:test';
import type { SheetsExportChunk } from '@server/core/bridge-client';
import { isSoftDeleteTable } from '@server/core/soft-delete';
import { seedHandover, seedHandoverEnv } from '@server-test/handover-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  EXPORT_CELL_MAX_CHARS,
  EXPORT_CHUNK_CHARS,
  EXPORT_TABLES,
  exportTableChunks,
  exportTableSpec,
  readExportPage,
} from './sheets-export';

let env: TestEnv;

async function insertBrands(count: number): Promise<void> {
  // satu INSERT banyak-baris per 500 baris: jauh lebih cepat lewat jaringan daripada satu pernyataan per baris
  for (let from = 0; from < count; from += 500) {
    const n = Math.min(500, count - from);
    const binds: Array<string | number> = [];
    for (let i = from; i < from + n; i++) {
      binds.push(`b${String(i).padStart(5, '0')}`, `Merk ${i}`, `merk ${i}`);
    }
    await env.DB.prepare(
      `INSERT INTO brands (id, name, \`key\`) VALUES ${Array(n).fill('(?, ?, ?)').join(', ')}`,
    )
      .bind(...binds)
      .run();
  }
}

async function collect(table: string, pageRows?: number): Promise<SheetsExportChunk[]> {
  const spec = exportTableSpec(table);
  if (!spec) throw new Error(`tabel ${table} tidak diekspor`);
  const out: SheetsExportChunk[] = [];
  for await (const chunk of exportTableChunks(env.DB, spec, pageRows)) out.push(chunk);
  return out;
}

beforeEach(async () => {
  env = await createTestEnv();
});

describe('exportTableChunks', () => {
  test('1.200 baris -> 3 potongan (500/500/200), replace lalu append, urutan terjaga', async () => {
    await insertBrands(1200);
    const chunks = await collect('brands');
    expect(chunks.map((chunk) => chunk.rows.length)).toEqual([500, 500, 200]);
    expect(chunks.map((chunk) => chunk.mode)).toEqual(['replace', 'append', 'append']);
    expect(chunks.every((chunk) => chunk.sheet === 'export_brands')).toBe(true);
    const ids = chunks.flatMap((chunk) => chunk.rows.map((row) => row[0]));
    expect(ids).toHaveLength(1200);
    expect(ids).toEqual([...ids].sort());
    expect(chunks[0]?.columns[0]).toBe('id');
    expect(chunks[2]?.rows[199]?.[0]).toBe('b01199');
    // nilai angka menjadi teks
    expect(chunks[0]?.rows[3]?.[chunks[0].columns.indexOf('item_count')]).toBe('0');
  });

  test('jumlah baris kelipatan halaman tidak menghasilkan potongan kosong tambahan berbahaya', async () => {
    await insertBrands(1000);
    const chunks = await collect('brands');
    expect(chunks.map((chunk) => chunk.rows.length)).toEqual([500, 500]);
    expect(chunks.map((chunk) => chunk.mode)).toEqual(['replace', 'append']);
  });

  test('baris terhapus (soft delete) tidak diekspor, di halaman pertama maupun lanjutan', async () => {
    await insertBrands(5);
    await env.DB.prepare(
      "UPDATE brands SET deleted_at = '2026-02-02T00:00:00.000Z' WHERE id IN ('b00001', 'b00003')",
    ).run();
    const chunks = await collect('brands', 2);
    const ids = chunks.flatMap((chunk) =>
      chunk.rows.map((row) => row[chunk.columns.indexOf('id')]),
    );
    expect(ids).toEqual(['b00000', 'b00002', 'b00004']);
  });

  test('komentar milik task terhapus tidak diekspor (anak ikut induk, N4)', async () => {
    await seedHandoverEnv(env);
    const comment = (id: string) => ({
      id,
      author: 'wh@gmail.com',
      at: '2026-02-02T00:00:00.000Z',
      quote: '',
      before: '',
      after: '',
      body: 'halo',
    });
    await seedHandover(env, { id: 'h1', number: 'ST-1', locationId: 'loc-a' }, [comment('c1')]);
    await seedHandover(env, { id: 'h2', number: 'ST-2', locationId: 'loc-a' }, [comment('c2')]);
    await env.DB.prepare(
      "UPDATE handovers SET deleted_at = '2026-02-02T00:00:00.000Z' WHERE id = 'h2'",
    ).run();
    const chunks = await collect('handover_comments');
    expect(
      chunks.flatMap((chunk) => chunk.rows.map((row) => row[chunk.columns.indexOf('id')])),
    ).toEqual(['c1']);
  });

  test('tabel kosong tetap menghasilkan satu potongan replace berisi header saja', async () => {
    const chunks = await collect('brands');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ mode: 'replace', rows: [] });
    expect(chunks[0]?.columns).toContain('item_count');
    expect(chunks[0]?.columns).not.toContain('sync_rev');
  });

  test('halaman dapat dilanjutkan dari nextKey (consumer antrean)', async () => {
    await insertBrands(7);
    const spec = exportTableSpec('brands');
    if (!spec) throw new Error('spec');
    const one = await readExportPage(env.DB, spec, null, true, 3);
    expect(one.rowCount).toBe(3);
    expect(one.nextKey).toBe('b00002');
    expect(one.chunks[0]?.mode).toBe('replace');
    const two = await readExportPage(env.DB, spec, one.nextKey, false, 3);
    expect(two.chunks[0]?.mode).toBe('append');
    expect(two.chunks[0]?.rows.map((row) => row[0])).toEqual(['b00003', 'b00004', 'b00005']);
    const three = await readExportPage(env.DB, spec, two.nextKey, false, 3);
    expect(three.rowCount).toBe(1);
    expect(three.nextKey).toBeNull();
  });

  test('kunci integer (audit_log) dilanjutkan secara numerik, bukan leksikografis', async () => {
    for (let i = 1; i <= 12; i++) {
      await env.DB.prepare('INSERT INTO audit_log (ts, actor, action, target) VALUES (?, ?, ?, ?)')
        .bind(`2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`, 'a@x', 'tes', `t${i}`)
        .run();
    }
    const chunks = await collect('audit_log', 5);
    const ids = chunks.flatMap((chunk) => chunk.rows.map((row) => Number(row[0])));
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  test('halaman besar dipecah menurut anggaran karakter; sel > 50.000 karakter dipotong', async () => {
    // isi besar dibangkitkan di sisi server (REPEAT): mengirim ±1,2 MB lewat terowongan membuat tes lambat
    const rows: string[] = [];
    const binds: string[] = [];
    for (let i = 0; i < 30; i++) {
      rows.push(`(?, ?, ?, REPEAT('${i === 0 ? 'y' : 'x'}', ${i === 0 ? 70000 : 40000}))`);
      binds.push(`i${String(i).padStart(2, '0')}`, `M${i}`, `k${i}`);
    }
    await env.DB.prepare(
      `INSERT INTO items (id, model, \`key\`, detail_md) VALUES ${rows.join(', ')}`,
    )
      .bind(...binds)
      .run();
    const chunks = await collect('items');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.mode)).toEqual([
      'replace',
      ...chunks.slice(1).map(() => 'append' as const),
    ]);
    for (const chunk of chunks) {
      const chars = chunk.rows.reduce((sum, row) => sum + row.reduce((s, c) => s + c.length, 0), 0);
      expect(chars).toBeLessThanOrEqual(EXPORT_CHUNK_CHARS + 50000);
    }
    const first = chunks[0]?.rows[0] ?? [];
    const detail = first[chunks[0]?.columns.indexOf('detail_md') ?? 0] ?? '';
    expect(detail.length).toBe(EXPORT_CELL_MAX_CHARS);
    expect(detail.endsWith('[dipotong]')).toBe(true);
    expect(chunks.flatMap((chunk) => chunk.rows)).toHaveLength(30);
  });

  test('semua nama sheet ekspor berawalan export_ dan unik; kolom sama dengan skema MariaDB (selain kolom teknis)', async () => {
    const sheets = EXPORT_TABLES.map((spec) => spec.sheet);
    expect(sheets.every((name) => /^export_[a-z0-9_]+$/.test(name))).toBe(true);
    expect(new Set(sheets).size).toBe(sheets.length);
    // Kolom teknis MariaDB yang sengaja tidak diekspor: kolom turunan name_key (indeks UNIK ekspresi) dan
    // handover_comments.seq (pengganti rowid untuk urutan/kursor), qr_presets.bu_key (kolom virtual untuk indeks unik),
    // dan handovers.client_id / handover_comments.client_id (kunci idempotensi antrean offline, Tahap C; tak bernilai ekspor).
    const technical: Record<string, string[]> = {
      roles: ['name_key'],
      locations: ['name_key'],
      handovers: ['client_id'],
      handover_comments: ['seq', 'client_id'],
      qr_presets: ['bu_key'],
    };
    // `deleted_at`/`deleted_by` (soft delete) juga teknis: baris terhapus disaring dari ekspor, jadi isinya selalu kosong.
    for (const spec of EXPORT_TABLES) {
      const softDeleteColumns = isSoftDeleteTable(spec.table) ? ['deleted_at', 'deleted_by'] : [];
      const info = await env.DB.prepare(
        'SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      )
        .bind(spec.table)
        .all<{ name: string }>();
      const actual = info.results
        .map((row) => row.name)
        .filter(
          (name) =>
            !(technical[spec.table] ?? []).includes(name) && !softDeleteColumns.includes(name),
        )
        .sort();
      expect({ table: spec.table, columns: [...spec.columns].sort() }).toEqual({
        table: spec.table,
        columns: actual,
      });
      expect(spec.columns).toContain(spec.key);
    }
  });

  test('tabel operasional tidak diekspor', () => {
    for (const table of ['jobs', 'counters', 'rate_limits', 'd1_migrations']) {
      expect(exportTableSpec(table)).toBeUndefined();
    }
  });
});
