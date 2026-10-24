import { beforeEach, describe, expect, test } from 'bun:test';
import type { SheetsExportChunk } from '@worker/core/bridge-client';
import { createTestEnv, type TestEnv } from '@worker-test/test-env';
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
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < count; i++) {
    statements.push(
      env.DB.prepare('INSERT INTO brands (id, name, key, sync_rev) VALUES (?, ?, ?, ?)').bind(
        `b${String(i).padStart(5, '0')}`,
        `Merk ${i}`,
        `merk ${i}`,
        i,
      ),
    );
  }
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
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
    expect(chunks[0]?.rows[3]?.[5]).toBe('3');
  });

  test('jumlah baris kelipatan halaman tidak menghasilkan potongan kosong tambahan berbahaya', async () => {
    await insertBrands(1000);
    const chunks = await collect('brands');
    expect(chunks.map((chunk) => chunk.rows.length)).toEqual([500, 500]);
    expect(chunks.map((chunk) => chunk.mode)).toEqual(['replace', 'append']);
  });

  test('tabel kosong tetap menghasilkan satu potongan replace berisi header saja', async () => {
    const chunks = await collect('brands');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ mode: 'replace', rows: [] });
    expect(chunks[0]?.columns).toContain('sync_rev');
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
    const big = 'x'.repeat(40000);
    for (let i = 0; i < 30; i++) {
      await env.DB.prepare('INSERT INTO items (id, model, key, detail_md) VALUES (?, ?, ?, ?)')
        .bind(`i${String(i).padStart(2, '0')}`, `M${i}`, `k${i}`, i === 0 ? 'y'.repeat(70000) : big)
        .run();
    }
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

  test('semua nama sheet ekspor berawalan export_ dan unik; kolom sama dengan skema D1', async () => {
    const sheets = EXPORT_TABLES.map((spec) => spec.sheet);
    expect(sheets.every((name) => /^export_[a-z0-9_]+$/.test(name))).toBe(true);
    expect(new Set(sheets).size).toBe(sheets.length);
    for (const spec of EXPORT_TABLES) {
      const info = await env.DB.prepare(`PRAGMA table_info("${spec.table}")`).all<{
        name: string;
      }>();
      expect({ table: spec.table, columns: [...spec.columns].sort() }).toEqual({
        table: spec.table,
        columns: info.results.map((row) => row.name).sort(),
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
