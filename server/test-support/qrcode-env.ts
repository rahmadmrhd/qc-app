import type { Env } from '@server/core/env';
import { ensureQrDocFolder } from '@server/modules/qrcode/folders';
import {
  insertQrDesignStmt,
  insertQrPresetStmt,
  type QrDesignRecord,
  type QrPresetRecord,
} from '@server/modules/qrcode/repo';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { seedRole, seedUser } from './access-fixtures';
import { seedBrand, seedItem } from './item-fixtures';
import { restCall } from './rest-call';
import type { TestEnv } from './test-env';

/**
 * qrview@/qredit@/qrmanage@ = modul qrcode per level (Semua lokasi; edit/manage ditambah item view); noqr@ = item view
 * saja.
 */
export async function seedQrEnv(env: TestEnv): Promise<void> {
  await seedRole(env, { id: 'r-qv', name: 'QR view', permissions: { qrcode: 'view' } });
  // edit/manage juga melihat item (semua BU): konfigurasi QR wajib memilih item (spek 4a).
  await seedRole(env, {
    id: 'r-qe',
    name: 'QR edit',
    permissions: { qrcode: 'edit', item: 'view' },
  });
  await seedRole(env, {
    id: 'r-qm',
    name: 'QR manage',
    permissions: { qrcode: 'manage', item: 'view' },
  });
  await seedRole(env, { id: 'r-item', name: 'Item', permissions: { item: 'view' } });
  await seedUser(env, { id: 'u-qv', email: 'qrview@gmail.com', roleIds: ['r-qv'] });
  await seedUser(env, { id: 'u-qe', email: 'qredit@gmail.com', roleIds: ['r-qe'] });
  await seedUser(env, { id: 'u-qm', email: 'qrmanage@gmail.com', roleIds: ['r-qm'] });
  await seedUser(env, { id: 'u-nq', email: 'noqr@gmail.com', roleIds: ['r-item'] });
}

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
export type QrCallResult = { ok: boolean; data?: any; error?: any };

/** Memanggil satu id sebagai `email` lewat kabel REST nyata. */
export async function qrCall(
  env: TestEnv,
  email: string,
  method: string,
  payload: unknown,
): Promise<QrCallResult> {
  return (await restCall(env, email, method, payload)) as QrCallResult;
}

/**
 * Dokumen PDF sumber BARU di tiap pemanggilan (satu PDF hanya untuk satu konfigurasi QR): berkas di folder
 * dokumen (bridge palsu), dibagikan, dan baris `qr_documents`.
 */
export async function qrPdfDocumentId(env: TestEnv): Promise<string> {
  const folder = await ensureQrDocFolder(env);
  const driveId = await env.BRIDGE.createFile(
    folder,
    'sumber.pdf',
    'application/pdf',
    'JVBERi0xLjQK',
  );
  await env.BRIDGE.shareAnyoneWithLink(driveId);
  const id = crypto.randomUUID();
  const now = '2026-10-16T00:00:00.000Z';
  await env.DB.prepare(
    "INSERT INTO qr_documents (id, drive_id, name, size, shared, created_at, created_by, updated_at, updated_by) VALUES (?, ?, 'sumber.pdf', 9, '1', ?, 'seed@gmail.com', ?, 'seed@gmail.com')",
  )
    .bind(id, driveId, now, now)
    .run();
  return id;
}

const QR_SEED_TIME = '2026-11-10T00:00:00.000Z';

/** Penanda hapus lunak tidak ikut `INSERT` produksi (selalu hidup): fixture menuliskannya bila diminta (`deletedAt`). */
async function markSeedDeleted(
  env: Pick<Env, 'DB'>,
  table: 'qr_designs' | 'qr_presets',
  record: { id: string; deletedAt: string; deletedBy: string },
): Promise<void> {
  if (record.deletedAt === '') return;
  await env.DB.prepare(`UPDATE ${table} SET deleted_at = ?, deleted_by = ? WHERE id = ?`)
    .bind(record.deletedAt, record.deletedBy, record.id)
    .run();
}

/** Konfigurasi QR uji langsung ke basis data (tanpa lewat validasi layanan); bagian yang tak disebut berbawaan. */
export async function seedQrDesign(
  env: Pick<Env, 'DB'>,
  design: Partial<QrDesignRecord> & { id: string },
): Promise<QrDesignRecord> {
  const record: QrDesignRecord = {
    title: design.id,
    linkSource: 'url',
    link: 'https://contoh.test/x',
    documentId: '',
    subtitle: '',
    footer: '',
    logoFileId: '',
    layout: DEFAULT_QR_LAYOUT,
    style: DEFAULT_QR_STYLE,
    overflow: false,
    exportedHash: '',
    exportedAt: '',
    exportedBy: '',
    exportPdfDriveId: '',
    exportPngDriveId: '',
    name: '',
    namePlacement: '',
    presetId: '',
    createdAt: QR_SEED_TIME,
    createdBy: 'seed@gmail.com',
    updatedAt: QR_SEED_TIME,
    updatedBy: 'seed@gmail.com',
    deletedAt: '',
    deletedBy: '',
    ...design,
  };
  await env.DB.batch([insertQrDesignStmt(env.DB, record)]);
  await markSeedDeleted(env, 'qr_designs', record);
  return record;
}

/** Preset QR uji langsung ke basis data; `buId` kosong = preset lama tanpa BU. */
export async function seedQrPreset(
  env: Pick<Env, 'DB'>,
  preset: Partial<QrPresetRecord> & { id: string },
): Promise<QrPresetRecord> {
  const record: QrPresetRecord = {
    name: preset.id,
    title: '',
    subtitle: '',
    footer: '',
    layout: DEFAULT_QR_LAYOUT,
    style: DEFAULT_QR_STYLE,
    defaultLogoId: '',
    buId: '',
    namePlacement: '',
    createdAt: QR_SEED_TIME,
    createdBy: 'seed@gmail.com',
    updatedAt: QR_SEED_TIME,
    updatedBy: 'seed@gmail.com',
    deletedAt: '',
    deletedBy: '',
    ...preset,
  };
  await env.DB.batch([insertQrPresetStmt(env.DB, record)]);
  await markSeedDeleted(env, 'qr_presets', record);
  return record;
}

/** Item aktif BARU di BU bawaan (satu item hanya untuk satu konfigurasi QR): pasangan `qrPdfDocumentId`. */
export async function qrItemId(env: Pick<Env, 'DB'>): Promise<string> {
  const id = `qr-item-${crypto.randomUUID()}`;
  await seedBrand(env, 'Merk Uji', { id: 'brand-merk-uji' }).catch(() => undefined);
  await seedItem(env, { id, brand: 'Merk Uji', brandId: 'brand-merk-uji', model: id });
  return id;
}

/**
 * Bagian isian Manual Book (nama, preset, satu item baru) untuk badan `qrcodes.save` pada tes. Nama bawaan unik per
 * panggilan karena nama Manual Book harus unik antar konfigurasi (keputusan pemilik 2026-11-11).
 */
export async function qrManualBookFields(
  env: Pick<Env, 'DB'>,
  name = `Manual Uji ${crypto.randomUUID().slice(0, 8)}`,
): Promise<{ name: string; presetId: string; itemIds: string[] }> {
  return { name, presetId: '', itemIds: [await qrItemId(env)] };
}
