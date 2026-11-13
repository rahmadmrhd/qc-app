import type { Env } from '@server/core/env';
import { registerSerialStockListeners } from '@server/modules/sticker/serial-listener';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from './access-fixtures';
import { seedBrand, seedItem } from './item-fixtures';
import { seedGuideImage, seedSticker, seedStickerType } from './sticker-fixtures';

const SEED_TIME = '2026-11-12T00:00:00.000Z';

export const SERIAL_USERS = {
  /** `serial: edit` di BU A saja (tanpa `item: view`). */
  writer: 'pencatat@gmail.com',
  /** `serial: view` di BU A. */
  viewer: 'pelihat@gmail.com',
  /** `serialservice: view` di BU A saja. */
  service: 'servis@gmail.com',
  /** `serial: edit` di BU A dan B. */
  both: 'dua-bu@gmail.com',
  /** Tanpa peran. */
  nobu: 'tanpa-bu@gmail.com',
} as const;

/**
 * Dunia uji Serial Number: BU `bu-a`/`bu-b`; pengguna (lihat `SERIAL_USERS`); lokasi `loc-sby` (Surabaya) dan
 * `loc-jkt` (Jakarta); item `i-a1` (BU A), `i-a2` (A dan B), `i-b` (B), `i-off` (nonaktif); stiker `s1` "Segel A" dan
 * `s2` "Segel B" yang berlaku bagi `i-a1` dan `i-a2` (penanda instruksi).
 */
export async function seedSerialWorld(env: Env): Promise<void> {
  // Daftar pendengar bus event adalah keadaan modul bersama satu proses `bun test`; tes lain (mis. `core/events.test.ts`)
  // mengosongkannya. Pendaftaran idempoten, jadi tes serial tidak bergantung pada urutan berkas dalam proses.
  registerSerialStockListeners();
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B' });
  await seedRole(env, { id: 'r-edit', name: 'Serial edit', permissions: { serial: 'edit' } });
  await seedRole(env, { id: 'r-view', name: 'Serial view', permissions: { serial: 'view' } });
  await seedRole(env, {
    id: 'r-svc',
    name: 'Servis view',
    permissions: { serialservice: 'view' },
  });
  await seedUser(env, {
    id: 'u-w',
    email: SERIAL_USERS.writer,
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-edit'] }],
  });
  await seedUser(env, {
    id: 'u-v',
    email: SERIAL_USERS.viewer,
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-view'] }],
  });
  await seedUser(env, {
    id: 'u-s',
    email: SERIAL_USERS.service,
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-svc'] }],
  });
  await seedUser(env, {
    id: 'u-both',
    email: SERIAL_USERS.both,
    buAssignments: [
      { buId: 'bu-a', roleIds: ['r-edit'] },
      { buId: 'bu-b', roleIds: ['r-edit'] },
    ],
  });
  await seedUser(env, {
    id: 'u-nobu',
    email: SERIAL_USERS.nobu,
    assignments: [],
    buAssignments: [],
  });
  await seedLocation(env, { id: 'loc-sby', code: 'SBY', name: 'Surabaya' });
  await seedLocation(env, { id: 'loc-jkt', code: 'JKT', name: 'Jakarta' });
  await seedBrand(env, 'Merk');
  await seedItem(env, { id: 'i-a1', brand: 'Merk', model: 'Alfa', businessUnitIds: ['bu-a'] });
  await seedItem(env, {
    id: 'i-a2',
    brand: 'Merk',
    model: 'Beta',
    businessUnitIds: ['bu-a', 'bu-b'],
  });
  await seedItem(env, { id: 'i-b', brand: 'Merk', model: 'Gamma', businessUnitIds: ['bu-b'] });
  await seedItem(env, {
    id: 'i-off',
    brand: 'Merk',
    model: 'Delta',
    businessUnitIds: ['bu-a'],
    status: 'inactive',
  });
  await seedGuideImage(env, { id: 'g1' });
  await seedStickerType(env, { id: 't1', name: 'Jenis', rule: 'none' });
  await seedSticker(env, { id: 's1', typeId: 't1', name: 'Segel A' });
  await seedSticker(env, { id: 's2', typeId: 't1', name: 'Segel B' });
  for (const itemId of ['i-a1', 'i-a2']) {
    await env.DB.prepare(
      "INSERT INTO item_sticker_photos (item_id, guide_id, caption, bu_id, `position`) VALUES (?, 'g1', '', '', 0)",
    )
      .bind(itemId)
      .run();
    for (const [position, stickerId] of ['s1', 's2'].entries()) {
      await env.DB.prepare(
        "INSERT INTO item_sticker_marks (item_id, guide_id, `position`, x, y, sticker_id, type_id, note) VALUES (?, 'g1', ?, 1, 1, ?, '', '')",
      )
        .bind(itemId, position, stickerId)
        .run();
    }
  }
}

export interface SeedSerial {
  id: string;
  serial: string;
  buId?: string;
  itemId?: string;
  testDate?: string;
  sample?: boolean;
  note?: string;
  locationId?: string;
  recordedLocationId?: string;
  status?: string;
  custody?: string;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  clientId?: string;
  stickers?: { stickerId: string; qty: number }[];
}

/** Catatan serial langsung ke basis data (tanpa stok) beserta kejadian `recorded` bernomor 1. */
export async function seedSerial(env: Env, serial: SeedSerial): Promise<void> {
  const createdAt = serial.createdAt ?? SEED_TIME;
  const location = serial.locationId ?? 'loc-sby';
  await env.DB.prepare(
    'INSERT INTO serials (id, client_id, bu_id, serial, item_id, test_date, sample, note, location_id, recorded_location_id, status, custody, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      serial.id,
      serial.clientId ?? `client-${serial.id}`,
      serial.buId ?? 'bu-a',
      serial.serial,
      serial.itemId ?? 'i-a1',
      serial.testDate ?? '2026-11-12',
      serial.sample ? 1 : 0,
      serial.note ?? '',
      location,
      serial.recordedLocationId ?? location,
      serial.status ?? 'good',
      serial.custody ?? 'qc',
      createdAt,
      serial.createdBy ?? 'seed@gmail.com',
      serial.updatedAt ?? createdAt,
      serial.createdBy ?? 'seed@gmail.com',
    )
    .run();
  for (const sticker of serial.stickers ?? []) {
    await env.DB.prepare(
      'INSERT INTO serial_stickers (serial_id, sticker_id, qty) VALUES (?, ?, ?)',
    )
      .bind(serial.id, sticker.stickerId, sticker.qty)
      .run();
  }
  await env.DB.prepare(
    "INSERT INTO serial_events (id, serial_id, case_id, seq, type, occurred_on, created_at, actor_id, actor_name, actor_team, message, changes_json, data_json) VALUES (?, ?, '', 1, 'recorded', ?, ?, 'seed', 'Seed', 'qc', '', '[]', '{}')",
  )
    .bind(`${serial.id}-e1`, serial.id, serial.testDate ?? '2026-11-12', createdAt)
    .run();
}
