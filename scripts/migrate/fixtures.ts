import type { Db } from '@server/core/db';
import {
  type CellValue,
  type DiscardApproval,
  type ImportOptions,
  type ImportPlan,
  type ImportResult,
  prepareImport,
} from './import-sheets';
import { DISCARD_TABLES, tableDef } from './schema-map';

export type Dump = Record<string, CellValue[][]>;

/** Menerapkan rencana impor ke MariaDB seperti `mariadb < import.sql`: DDL di luar transaksi, data dalam SATU transaksi. */
export async function applyPlan(db: Db, plan: ImportPlan): Promise<void> {
  for (const statement of plan.before) await db.exec(statement);
  await db.batch(plan.transaction.map((item) => db.prepare(item.sql).bind(...item.params)));
}

/** Impor dengan persetujuan pembuangan yang cocok persis dengan dump (kecuali `options.discardApproval`). */
export function importWithApproval(dump: Dump, options: ImportOptions = {}): ImportResult {
  return prepareImport(dump, { discardApproval: approvalFor(dump), ...options });
}

/** Pemilik produk menyetujui membuang isi dump yang akan dibuang, persis seperti terlihat sekarang. */
export function approvalFor(dump: Dump): DiscardApproval {
  const template = prepareImport(dump).report.approvalTemplate;
  return { ...template, approvedBy: 'Pemilik Produk', approvedOn: '2026-11-06' };
}

/** Dump tanpa tabel yang dibuang (tak ada yang perlu disetujui) dan tanpa berkas milik item. */
export function stripDiscarded(dump: Dump): Dump {
  const copy = structuredClone(dump);
  for (const def of DISCARD_TABLES) delete copy[def.name];
  const files = copy.files as CellValue[][];
  const ownerAt = (files[0] as CellValue[]).indexOf('owner_type');
  copy.files = files.filter((row, index) => index === 0 || row[ownerAt] !== 'item');
  return copy;
}

/** Membangun grid Sheets (header + baris) dari objek per baris; kolom yang tidak disebut = ''. */
export function grid(table: string, rows: ReadonlyArray<Record<string, CellValue>>): CellValue[][] {
  const columns = tableDef(table).columns.map((column) => column.name);
  return [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ''))];
}

const T1 = '2026-10-01T03:00:00.000Z';
const T2 = '2026-10-02T04:30:00.000Z';

/** Dump bersih yang mewakili semua tabel (dipakai tes impor dan verifikasi). */
export function cleanDump(): Dump {
  const checks = [{ text: 'Unit A', by: 'qc@x.id', at: T2, occurrence: 0 }];
  const comments = [
    {
      id: 'c1',
      quote: 'Unit A',
      before: '',
      after: '',
      body: 'Cek ulang',
      author: 'wh@x.id',
      at: T1,
    },
    { id: 'c2', quote: '', before: '', after: '', body: 'Umum', author: 'qc@x.id', at: T2 },
  ];
  return {
    users: grid('users', [
      {
        id: 'u1',
        email: 'admin@x.id',
        name: 'Admin',
        status: 'active',
        created_at: T1,
        updated_at: T1,
        updated_by: 'seed',
        assignments: JSON.stringify([{ locationId: null, roleIds: ['r1'] }]),
      },
      {
        id: 'u2',
        email: 'staf@x.id',
        name: 'Staf',
        status: 'active',
        created_at: T1,
        updated_at: T1,
        updated_by: 'seed',
        assignments: JSON.stringify([{ locationId: 'l1', roleIds: ['r1'] }]),
      },
    ]),
    roles: grid('roles', [
      {
        id: 'r1',
        name: 'Admin',
        permissions: '{"access":"manage"}',
        created_at: T1,
        updated_at: T1,
        updated_by: 'seed',
      },
    ]),
    locations: grid('locations', [
      {
        id: 'l1',
        code: 'A',
        name: 'Gudang A',
        status: 'active',
        created_at: T1,
        updated_at: T1,
        updated_by: 'seed',
      },
      {
        id: 'l2',
        code: 'B',
        name: 'Gudang B',
        status: 'active',
        created_at: T1,
        updated_at: T1,
        updated_by: 'seed',
      },
    ]),
    audit_log: grid('audit_log', [
      {
        ts: T1,
        actor: 'admin@x.id',
        action: 'user.save',
        target: 'u1',
        before: '',
        after: '{"a":1}',
      },
      {
        ts: T2,
        actor: 'admin@x.id',
        action: 'user.save',
        target: 'u2',
        before: '',
        // Karakter yang harus selamat dari escaping SQL: kutip, backslash, kutip ganda JSON, emoji, CR/LF, Ctrl-Z.
        after: JSON.stringify({
          nama: 'O\'Brien \\ "x"',
          emoji: '\u{1F600}',
          baris: 'a\nb\r\nc',
          ctrlz: String.fromCharCode(26),
        }),
      },
      {
        ts: T2,
        actor: 'staf@x.id',
        action: 'handover.save',
        target: 'h1',
        before: '{}',
        after: '{}',
      },
    ]),
    brands: grid('brands', [
      {
        id: 'b1',
        external_id: 'EXT-1',
        name: 'Acme',
        key: 'acme',
        status: 'active',
        sync_rev: '3',
        created_at: T1,
        updated_at: T1,
        updated_by: 'seed',
      },
      {
        id: 'b2',
        name: 'Beta',
        key: 'beta',
        status: 'active',
        sync_rev: '5',
        created_at: T1,
        updated_at: T1,
        updated_by: 'seed',
      },
    ]),
    customers: grid('customers', [
      {
        id: 'c1',
        name: 'CV Abadi',
        key: 'cv abadi',
        status: 'active',
        created_at: T1,
        updated_at: T1,
        updated_by: 'seed',
      },
    ]),
    files: grid('files', [
      {
        id: 'f1',
        drive_id: 'drv1',
        mime: 'image/jpeg',
        size: '1234',
        width: '800',
        height: '600',
        owner_type: 'item',
        owner_id: 'i1',
        created_at: T1,
        created_by: 'admin@x.id',
      },
      {
        id: 'f2',
        drive_id: 'drv2',
        mime: 'image/png',
        size: '99',
        width: '10',
        height: '10',
        owner_type: 'qrlogo',
        owner_id: 'shared',
        created_at: T1,
        created_by: 'admin@x.id',
      },
      {
        id: 'f3',
        drive_id: 'drv3',
        mime: 'image/png',
        size: '77',
        width: '5',
        height: '5',
        owner_type: '',
        owner_id: '',
        created_at: T1,
        created_by: 'admin@x.id',
      },
    ]),
    handovers: grid('handovers', [
      {
        id: 'h1',
        number: 'ST-20261001-001',
        location_id: 'l1',
        customer_id: 'c1',
        customer_name: 'CV Abadi',
        note: '- [ ] Unit A\n- [ ] Unit B\n- [ ] Unit C',
        status: 'open',
        checks: JSON.stringify(checks),
        comments: JSON.stringify(comments),
        created_at: T1,
        created_by: 'wh@x.id',
        updated_at: T2,
        updated_by: 'qc@x.id',
      },
      {
        id: 'h2',
        number: 'ST-20261001-002',
        location_id: 'l1',
        customer_id: 'c1',
        customer_name: 'CV Abadi',
        note: '- [ ] Satu',
        status: 'cancelled',
        created_at: T1,
        created_by: 'wh@x.id',
        updated_at: T1,
        updated_by: 'wh@x.id',
      },
      {
        id: 'h3',
        number: 'ST-20261002-007',
        location_id: 'l2',
        customer_id: '',
        customer_name: 'Tanpa Checklist',
        note: 'Catatan biasa',
        status: 'open',
        completed_at: T2,
        completed_by: 'qc@x.id',
        created_at: T2,
        created_by: 'wh@x.id',
        updated_at: T2,
        updated_by: 'qc@x.id',
      },
      {
        id: 'h4',
        number: 'ST-20261002-003',
        location_id: 'l2',
        customer_id: 'c1',
        customer_name: 'CV Abadi',
        note: '- [ ] X\n- [ ] Y',
        status: 'open',
        checks: JSON.stringify([
          { text: 'X', by: 'qc@x.id', at: T2, occurrence: 0 },
          { text: 'Y', by: 'qc@x.id', at: T2, occurrence: 0 },
        ]),
        created_at: T2,
        created_by: 'wh@x.id',
        updated_at: T2,
        updated_by: 'qc@x.id',
      },
    ]),
    items: grid('items', [
      {
        id: 'i1',
        external_id: 'EXT-I1',
        brand_id: 'b1',
        model: 'Model X',
        key: 'model x',
        is_country_lock: 'false',
        aliases: '["MX","Model Ex"]',
        stickers: '[]',
        accessories: '[]',
        attachments: '["f1"]',
        detail_md: '# Detail\n\nBaris "dua" dengan \'kutip\'',
        status: 'active',
        sync_rev: '7',
        created_at: T1,
        updated_at: T1,
        updated_by: 'seed',
      },
    ]),
    qr_designs: grid('qr_designs', [
      {
        id: 'q1',
        title: 'QR',
        link_source: 'url',
        link: 'https://x.id',
        document_id: 'd1',
        logo_file_id: 'f2',
        created_at: T1,
        created_by: 'admin@x.id',
        updated_at: T1,
        updated_by: 'admin@x.id',
      },
    ]),
    qr_documents: grid('qr_documents', [
      {
        id: 'd1',
        drive_id: 'drv9',
        name: 'sumber.pdf',
        size: '4096',
        shared: '1',
        created_at: T1,
        created_by: 'admin@x.id',
        updated_at: T1,
        updated_by: 'admin@x.id',
      },
    ]),
    qr_defaults: grid('qr_defaults', [
      {
        id: 'default',
        title: 'Judul',
        logo_file_ids: '["f2"]',
        default_logo_id: 'f2',
        updated_at: T1,
        updated_by: 'admin@x.id',
      },
    ]),
    qr_presets: grid('qr_presets', [
      {
        id: 'p1',
        name: 'Preset',
        default_logo_id: 'f2',
        created_at: T1,
        created_by: 'admin@x.id',
        updated_at: T1,
        updated_by: 'admin@x.id',
      },
    ]),
    sync_state: grid('sync_state', [
      { resource: 'brands', seq: '5', updated_at: T1 },
      { resource: 'items', seq: '9', updated_at: T1 },
    ]),
  };
}

/** Salinan dalam agar tes dapat memodifikasi sel tanpa memengaruhi fixture lain. */
export function mutate(
  dump: Dump,
  table: string,
  row: number,
  column: string,
  value: CellValue,
): Dump {
  const copy = structuredClone(dump);
  const sheet = copy[table] as CellValue[][];
  const header = sheet[0] as CellValue[];
  (sheet[row - 1] as CellValue[])[header.indexOf(column)] = value;
  return copy;
}
