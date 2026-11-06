import { describe, expect, test } from 'bun:test';
import { API_ROUTES, toRequestParts } from '@shared/api';
import { MARKDOWN_MAX_LENGTH } from '@shared/files';
import { HANDOVER_LIMITS } from '@shared/handover';
import { ITEM_LIMITS } from '@shared/items';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE, QR_LIMITS } from '@shared/qrcode';
import type { WorkerRpcInput, WorkerRpcMethod } from '@shared/rpc';
import { SYNC_LIMITS } from '@shared/sync';
import { MAX_JSON_BODY_BYTES, MAX_REQUEST_BODY_BYTES, SYNC_MAX_BODY_BYTES } from './body';

// Batas JSON REST 2 MB (keputusan pemilik 2026-11-06): muatan sah terbesar tiap rute JSON harus muat dengan lega.
// Karakter terburuk di JSON = karakter kendali (`\u0001`, 6 byte per karakter); emoji hanya 4 byte.

const WORST_CHAR = String.fromCharCode(1);
const text = (chars: number) => WORST_CHAR.repeat(chars);
const UUID = '123e4567-e89b-12d3-a456-426614174000';
const STAMP = '2026-11-06T00:00:00.000Z';

type Inputs = { [M in WorkerRpcMethod]?: WorkerRpcInput<M> };

const longList = <T>(count: number, make: (index: number) => T): T[] =>
  Array.from({ length: count }, (_, index) => make(index));

/** Satu muatan terburuk per id rute JSON bertubuh (penugasan: 500 lokasi x 20 peran, jauh di atas data nyata). */
const WORST: Inputs = {
  'access.users.save': {
    id: UUID,
    email: `${'a'.repeat(200)}@gmail.com`,
    name: text(100),
    status: 'active',
    assignments: longList(500, (index) => ({
      locationId: `${UUID}-${index}`,
      roleIds: longList(20, (role) => `${UUID}-${role}`),
    })),
  },
  'access.users.setStatus': { id: UUID, status: 'inactive' },
  'access.roles.save': {
    id: UUID,
    name: text(60),
    description: text(200),
    permissions: { access: 'manage', item: 'manage', qrcode: 'manage', handover: 'manage' },
  },
  'access.locations.save': { id: UUID, code: text(10), name: text(100) },
  'access.locations.setStatus': { id: UUID, status: 'inactive' },
  'brands.save': { id: UUID, name: text(ITEM_LIMITS.brand) },
  'brands.setStatus': { id: UUID, status: 'inactive' },
  'customers.rename': { id: UUID, name: text(HANDOVER_LIMITS.customerName) },
  'customers.setStatus': { id: UUID, status: 'inactive' },
  'items.save': {
    id: UUID,
    expectedUpdatedAt: STAMP,
    brand: text(ITEM_LIMITS.brand),
    model: text(ITEM_LIMITS.model),
    isCountryLock: true,
    aliases: longList(ITEM_LIMITS.aliases, () => text(ITEM_LIMITS.alias)),
    stickers: longList(ITEM_LIMITS.stickers, () => ({
      name: text(ITEM_LIMITS.stickerName),
      note: text(ITEM_LIMITS.stickerNote),
      fileId: UUID,
    })),
    accessories: longList(ITEM_LIMITS.accessories, () => ({
      name: text(ITEM_LIMITS.accessoryName),
      qty: ITEM_LIMITS.accessoryQty,
    })),
    attachments: longList(ITEM_LIMITS.attachments, () => UUID),
    detail: text(MARKDOWN_MAX_LENGTH),
  },
  'items.setStatus': { id: UUID, status: 'inactive' },
  'handovers.save': {
    id: UUID,
    locationId: UUID,
    customerName: text(HANDOVER_LIMITS.customerName),
    note: text(HANDOVER_LIMITS.note),
    expectedUpdatedAt: STAMP,
    base: {
      updatedAt: STAMP,
      customerName: text(HANDOVER_LIMITS.customerName),
      note: text(HANDOVER_LIMITS.note),
      cancelled: false,
      done: false,
    },
  } as never,
  'handovers.saveBatch': {
    locationId: UUID,
    tasks: longList(HANDOVER_LIMITS.batch, () => ({
      customerName: text(HANDOVER_LIMITS.customerName),
      note: text(HANDOVER_LIMITS.note),
    })),
  },
  'handovers.cancel': { id: UUID, locationId: UUID },
  'handovers.reopen': { id: UUID, locationId: UUID },
  'handovers.setDone': { id: UUID, locationId: UUID },
  'handovers.setCheck': { id: UUID, locationId: UUID, index: 299, text: text(5000), checked: true },
  'handovers.comment': {
    id: UUID,
    locationId: UUID,
    quote: text(HANDOVER_LIMITS.comment),
    before: text(HANDOVER_LIMITS.comment),
    after: text(HANDOVER_LIMITS.comment),
    body: text(HANDOVER_LIMITS.comment),
  },
  'qrcodes.save': {
    id: UUID,
    expectedUpdatedAt: STAMP,
    title: text(QR_LIMITS.title),
    linkSource: 'url',
    link: text(QR_LIMITS.link),
    documentId: UUID,
    subtitle: text(QR_LIMITS.subtitle),
    footer: text(QR_LIMITS.footer),
    logoFileId: UUID,
    layout: DEFAULT_QR_LAYOUT,
    style: DEFAULT_QR_STYLE,
    overflow: true,
  } as never,
  'qrcodes.savePreset': {
    id: UUID,
    expectedUpdatedAt: STAMP,
    name: text(QR_LIMITS.presetName),
    title: text(QR_LIMITS.title),
    subtitle: text(QR_LIMITS.subtitle),
    footer: text(QR_LIMITS.footer),
    layout: DEFAULT_QR_LAYOUT,
    style: DEFAULT_QR_STYLE,
    defaultLogoId: UUID,
  },
  'qrcodes.saveLogoLibrary': {
    expectedUpdatedAt: STAMP,
    logoFileIds: longList(QR_LIMITS.logoLibrary, () => UUID),
  },
  'qrcodes.cloneFromDrive': { source: text(2000), replaceDocumentId: UUID },
  'exports.sheets': { tables: longList(50, () => text(100)) },
};

const BODY_VERBS = new Set(['POST', 'PUT', 'PATCH']);

/** Id rute JSON bertubuh: bukan biner, verba tulis berbadan (termasuk varian `create`). */
function jsonBodyRouteIds(): WorkerRpcMethod[] {
  return (Object.keys(API_ROUTES) as WorkerRpcMethod[]).filter((id) => {
    const def = API_ROUTES[id];
    if (def.rawBody !== undefined || def.multipart !== undefined) return false;
    return BODY_VERBS.has(def.verb) || BODY_VERBS.has(def.create?.verb ?? '');
  });
}

describe('batas badan', () => {
  test('setiap rute JSON bertubuh punya muatan terburuk di tabel tes (rute baru wajib ditambahkan)', () => {
    expect(Object.keys(WORST).sort()).toEqual(jsonBodyRouteIds().sort());
  });

  test('muatan sah terbesar tiap rute JSON jauh di bawah 2 MB', () => {
    const sizes: Array<[string, number]> = [];
    for (const id of Object.keys(WORST) as WorkerRpcMethod[]) {
      const parts = toRequestParts(id, WORST[id] as never);
      const bytes = new TextEncoder().encode(JSON.stringify(parts.body ?? null)).length;
      sizes.push([id, bytes]);
      expect(bytes, id).toBeLessThan(MAX_JSON_BODY_BYTES);
    }
    // Terbesar nyata = saveBatch 30 x 5.000 karakter terburuk (~0,9 MB); pastikan ada ruang minimal 2x.
    const max = Math.max(...sizes.map(([, bytes]) => bytes));
    expect(max * 2).toBeLessThan(MAX_JSON_BODY_BYTES);
  });

  test('batas JSON 2 MB; batas push sinkron 5 MB (= kontrak); batas global Bun.serve diturunkan dari tabel rute biner', () => {
    expect(MAX_JSON_BODY_BYTES).toBe(2 * 1024 * 1024);
    const binaryMax = Math.max(
      ...Object.values(API_ROUTES).flatMap((def) => [
        def.rawBody?.maxBytes ?? 0,
        def.multipart?.maxBytes ?? 0,
      ]),
    );
    expect(binaryMax).toBe(QR_LIMITS.documentMaxBytes);
    expect(MAX_REQUEST_BODY_BYTES).toBeGreaterThan(binaryMax);
    // Tanpa ketergantungan pada batas 16 MB lama: global = rute biner terbesar + overhead, dan push sinkron muat di dalamnya.
    expect(MAX_REQUEST_BODY_BYTES).toBe(binaryMax + 64 * 1024);
    expect(MAX_REQUEST_BODY_BYTES).toBeLessThan(16 * 1024 * 1024);
    expect(SYNC_MAX_BODY_BYTES).toBe(SYNC_LIMITS.bodyBytes);
    expect(SYNC_MAX_BODY_BYTES).toBe(5_000_000);
    expect(SYNC_MAX_BODY_BYTES).toBeGreaterThan(MAX_JSON_BODY_BYTES);
    expect(SYNC_MAX_BODY_BYTES).toBeLessThan(MAX_REQUEST_BODY_BYTES);
  });
});
