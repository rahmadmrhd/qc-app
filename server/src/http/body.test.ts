import { describe, expect, test } from 'bun:test';
import { API_ROUTES, toRequestParts } from '@shared/api';
import { BATCH_MAX } from '@shared/batch';
import type { ApiId, ApiInput } from '@shared/contract';
import {
  CL_BINARY_MAX_BYTES,
  CL_PATH_MAX,
  CL_TEXT_MAX_BYTES,
  FIRMWARE_CODE_MAX,
} from '@shared/countrylock-bundle';
import { MARKDOWN_MAX_LENGTH, MAX_IMAGE_BYTES } from '@shared/files';
import { HANDOVER_LIMITS } from '@shared/handover';
import { ITEM_LIMITS } from '@shared/items';
import { POSTEL_LIMITS } from '@shared/postel';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE, QR_LIMITS } from '@shared/qrcode';
import { WAREHOUSE_LIMITS } from '@shared/serial-warehouse';
import { SERIAL_LIMITS, SERIAL_PROOF_LIMITS } from '@shared/serials';
import { GUIDE_LIMITS, INSTRUCTION_LIMITS, STICKER_LIMITS } from '@shared/stickers';
import { MAX_JSON_BODY_BYTES, MAX_REQUEST_BODY_BYTES } from './body';

// Batas JSON REST 2 MB (keputusan pemilik 2026-11-06): muatan sah terbesar tiap rute JSON harus muat dengan lega.
// Karakter terburuk di JSON = karakter kendali (`\u0001`, 6 byte per karakter); emoji hanya 4 byte.

const WORST_CHAR = String.fromCharCode(1);
const text = (chars: number) => WORST_CHAR.repeat(chars);
const UUID = '123e4567-e89b-12d3-a456-426614174000';
const STAMP = '2026-11-06T00:00:00.000Z';
/** Batch terbesar yang sah: `BATCH_MAX` id (panjang id maksimum 100). */
const BATCH_IDS = Array.from({ length: BATCH_MAX }, (_, index) => `${'i'.repeat(90)}-${index}`);

type Inputs = { [M in ApiId]?: ApiInput<M> };

const importMode = (ip: string) => ({
  ip,
  ipServer: '10.0.0.1',
  connectVia: 'Target' as const,
  interfaceBridge: 'b'.repeat(60),
});
const importBrand = (label: string) => ({
  label,
  username: 'u'.repeat(60),
  password: 'p'.repeat(60),
  web: `http://${'w'.repeat(100)}/{ip}`,
  modes: { single: importMode('192.168.1.20'), multi: importMode('') },
});

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
    buAssignments: longList(200, (index) => ({
      buId: `${UUID}-${index}`,
      roleIds: longList(20, (role) => `${UUID}-${role}`),
    })),
  },
  'access.users.setStatus': { id: UUID, status: 'inactive' },
  // Country Lock: teks skrip maksimum (200 KB) berisi karakter terburuk yang lolos validator (tanda kutip: 1 byte -> 2 byte JSON;
  // karakter kontrol selain tab/LF/CR ditolak validator, jadi bukan escape 6-byte).
  'clFiles.save': {
    path: 'p'.repeat(CL_PATH_MAX),
    role: 'script',
    text: '"'.repeat(CL_TEXT_MAX_BYTES),
    message: text(200),
    baseSeq: 999_999_999,
    expectedUpdatedAt: STAMP,
  },
  'clFiles.revert': { id: UUID, seq: 999_999_999, message: text(200) },
  'clUploads.start': {
    path: 'p'.repeat(CL_PATH_MAX),
    role: 'router',
    size: CL_BINARY_MAX_BYTES,
    sha256: 'f'.repeat(64),
  },
  'clUploads.finish': { id: UUID },
  'clBundles.publish': { note: text(200) },
  'clBundles.reactivate': { number: '999999999', note: text(200) },
  // Impor sekali pakai: muatan terbesar yang DITERIMA validator (<= CL_IMPORT_MAX_JSON_BYTES = 900 KB; tanda kutip = 2 byte
  // JSON per karakter). Muatan lebih besar ditolak VALIDATION oleh validator, bukan 413, sehingga klien memecah impor.
  'clImport.run': {
    settings: {
      schema: 1,
      router: {
        ip: '10.0.0.1',
        username: 'admin',
        password: 'p'.repeat(200),
        interfaceBridge: 'b',
      },
      network: { computerIp: '10.0.0.5', prefixLength: 24 },
      brands: {
        mikrotik: importBrand('Mikrotik'),
        ubiquiti: importBrand('Ubiquiti'),
      },
    },
    scripts: longList(4, (index) => ({
      path: `${'p'.repeat(190)}${index}.rsc`,
      text: '"'.repeat(100_000),
      brand: 'mikrotik' as const,
    })),
    firmwares: longList(200, (index) => ({
      brand: 'ubiquiti' as const,
      code: `${'c'.repeat(FIRMWARE_CODE_MAX - 4)}${String(index).padStart(4, '0')}`,
      label: 'l'.repeat(120),
      scriptPath: `${'p'.repeat(190)}0.rsc`,
    })),
  },
  'clFirmwares.save': {
    id: UUID,
    brand: 'ubiquiti',
    code: 'c'.repeat(FIRMWARE_CODE_MAX),
    label: text(120),
    scriptPath: 'p'.repeat(CL_PATH_MAX),
    parallel: true,
    sort: 999_999_999,
    expectedUpdatedAt: STAMP,
  },
  'access.roles.save': {
    id: UUID,
    name: text(60),
    description: text(200),
    permissions: { access: 'manage', item: 'manage', qrcode: 'manage', handover: 'manage' },
  },
  'access.locations.save': { id: UUID, code: text(10), name: text(100) },
  'access.locations.setStatus': { id: UUID, status: 'inactive' },
  'access.businessUnits.save': { id: UUID, code: text(10), name: text(100) },
  'access.businessUnits.setStatus': { id: UUID, status: 'inactive' },
  'brands.save': {
    id: UUID,
    name: text(ITEM_LIMITS.brand),
    businessUnitIds: Array.from({ length: 50 }, () => UUID),
  },
  'brands.setStatus': { id: UUID, status: 'inactive' },
  'brands.setStatusBatch': { ids: BATCH_IDS, status: 'inactive' },
  'brands.removeBatch': { ids: BATCH_IDS },
  'brands.restoreBatch': { ids: BATCH_IDS },
  'qrcodes.removeBatch': { ids: BATCH_IDS },
  'qrcodes.restoreBatch': { ids: BATCH_IDS },
  'qrcodes.removePresetBatch': { ids: BATCH_IDS },
  'qrcodes.restorePresetBatch': { ids: BATCH_IDS },
  'serials.removeBatch': { ids: BATCH_IDS },
  'serials.restoreBatch': { ids: BATCH_IDS },
  'postels.removeBatch': { ids: BATCH_IDS },
  'postels.restoreBatch': { ids: BATCH_IDS },
  'stickerSettings.save': {
    expectedUpdatedAt: STAMP,
    alert: {
      enabled: true,
      cc: [],
      bcc: [],
      recipients: Array.from(
        { length: STICKER_LIMITS.alertRecipientsMax },
        (_, i) => `u${i}-${'x'.repeat(40)}@contoh.com`,
      ),
      digestHour: 23,
      intervalDays: 1,
    },
    defaults: Array.from({ length: 200 }, () => ({
      typeId: UUID,
      defaultMinQty: STICKER_LIMITS.qtyMax,
    })),
  },
  'stickerTypes.save': {
    id: UUID,
    expectedUpdatedAt: STAMP,
    name: text(STICKER_LIMITS.nameMax),
    rule: 'none',
  },
  'stickers.save': {
    id: UUID,
    expectedUpdatedAt: STAMP,
    typeId: UUID,
    name: text(STICKER_LIMITS.nameMax),
    alias: text(STICKER_LIMITS.aliasMax),
    fileId: UUID,
    minQty: STICKER_LIMITS.qtyMax,
    businessUnitIds: Array.from({ length: 50 }, () => UUID),
  },
  'stickers.setStatus': { id: UUID, status: 'inactive' },
  'stickers.setStatusBatch': { ids: BATCH_IDS, status: 'inactive' },
  'stickers.removeBatch': { ids: BATCH_IDS },
  'stickers.restoreBatch': { ids: BATCH_IDS },
  'stickerStock.record': {
    locationId: UUID,
    stickerId: UUID,
    kind: 'out',
    count: {
      rows: Array.from({ length: STICKER_LIMITS.countRows }, () => ({
        sheets: STICKER_LIMITS.qtyMax,
        perSheet: STICKER_LIMITS.qtyMax,
      })),
      loose: STICKER_LIMITS.qtyMax,
    },
    reason: text(STICKER_LIMITS.reasonMax),
  },
  'stickerStock.opname': {
    rows: Array.from({ length: STICKER_LIMITS.opnameRows }, () => ({
      stickerId: UUID,
      locationId: UUID,
      expectedQty: STICKER_LIMITS.qtyMax,
      count: {
        rows: Array.from({ length: STICKER_LIMITS.countRows }, () => ({
          sheets: STICKER_LIMITS.qtyMax,
          perSheet: STICKER_LIMITS.qtyMax,
        })),
        loose: STICKER_LIMITS.qtyMax,
      },
    })),
  },
  'stickerStock.recordBatch': {
    kind: 'out',
    reason: text(STICKER_LIMITS.reasonMax),
    rows: Array.from({ length: STICKER_LIMITS.opnameRows }, () => ({
      stickerId: UUID,
      locationId: UUID,
      count: {
        rows: Array.from({ length: STICKER_LIMITS.countRows }, () => ({
          sheets: STICKER_LIMITS.qtyMax,
          perSheet: STICKER_LIMITS.qtyMax,
        })),
        loose: STICKER_LIMITS.qtyMax,
      },
    })),
  },
  'stickerStock.adjustBatch': {
    reason: text(STICKER_LIMITS.reasonMax),
    rows: Array.from({ length: STICKER_LIMITS.opnameRows }, () => ({
      stickerId: UUID,
      locationId: UUID,
      delta: -STICKER_LIMITS.qtyMax,
    })),
  },
  'stickerStock.adjust': {
    locationId: UUID,
    stickerId: UUID,
    delta: -STICKER_LIMITS.qtyMax,
    reason: text(STICKER_LIMITS.reasonMax),
  },
  'stickerGuides.rename': { id: UUID, name: text(GUIDE_LIMITS.nameMax) },
  'stickerGuides.removeBatch': { ids: BATCH_IDS },
  'stickerTypes.setStatus': { id: UUID, status: 'inactive' },
  'stickerTypes.setStatusBatch': { ids: BATCH_IDS, status: 'inactive' },
  'stickerTypes.removeBatch': { ids: BATCH_IDS },
  'stickerTypes.restoreBatch': { ids: BATCH_IDS },
  'customers.rename': { id: UUID, name: text(HANDOVER_LIMITS.customerName) },
  'customers.setStatus': { id: UUID, status: 'inactive' },
  'items.save': {
    id: UUID,
    expectedUpdatedAt: STAMP,
    brandId: UUID,
    model: text(ITEM_LIMITS.model),
    isCountryLock: true,
    aliases: longList(ITEM_LIMITS.aliases, () => text(ITEM_LIMITS.alias)),
    stickerPhotos: longList(INSTRUCTION_LIMITS.photos, () => ({
      guideId: UUID,
      caption: text(INSTRUCTION_LIMITS.caption),
      buId: UUID,
      marks: longList(INSTRUCTION_LIMITS.marks, () => ({
        x: INSTRUCTION_LIMITS.coordMax,
        y: INSTRUCTION_LIMITS.coordMax,
        target: { kind: 'sticker' as const, stickerId: UUID },
        note: text(INSTRUCTION_LIMITS.markNote),
      })),
    })),
    accessories: longList(ITEM_LIMITS.accessories, () => ({
      name: text(ITEM_LIMITS.accessoryName),
      qty: ITEM_LIMITS.accessoryQty,
    })),
    attachments: longList(ITEM_LIMITS.attachments, () => UUID),
    detail: text(MARKDOWN_MAX_LENGTH),
    businessUnitIds: Array.from({ length: 50 }, () => UUID),
  },
  'items.setStatus': { id: UUID, status: 'inactive' },
  'items.setStatusBatch': { ids: BATCH_IDS, status: 'inactive' },
  'items.removeBatch': { ids: BATCH_IDS },
  'items.restoreBatch': { ids: BATCH_IDS },
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
      clientId: UUID,
    })),
  },
  'handovers.cancel': { id: UUID, locationId: UUID },
  'handovers.reopen': { id: UUID, locationId: UUID },
  'handovers.restore': { id: UUID, locationId: UUID },
  'handovers.setDone': { id: UUID, locationId: UUID },
  'handovers.setCheck': { id: UUID, locationId: UUID, index: 299, text: text(5000), checked: true },
  'handovers.comment': {
    id: UUID,
    locationId: UUID,
    quote: text(HANDOVER_LIMITS.comment),
    before: text(HANDOVER_LIMITS.comment),
    after: text(HANDOVER_LIMITS.comment),
    body: text(HANDOVER_LIMITS.comment),
    clientId: UUID,
  },
  'qrcodes.save': {
    id: UUID,
    expectedUpdatedAt: STAMP,
    name: text(QR_LIMITS.manualBookName),
    presetId: UUID,
    itemIds: longList(QR_LIMITS.items, () => UUID),
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
  // Catatan dan kerusakan terpanjang berkarakter 4-byte (validator menghitung titik kode; karakter kontrol ditolak,
  // jadi bukan escape 6-byte).
  'serials.saveBatch': {
    rows: longList(SERIAL_LIMITS.batchRows, () => ({
      clientId: UUID,
      serial: 'S'.repeat(SERIAL_LIMITS.serialMax),
      itemId: UUID,
      buId: UUID,
      testDate: '2026-11-12',
      locationId: UUID,
      sample: true,
      note: '😀'.repeat(SERIAL_LIMITS.noteMax),
      // Terburuk: catatan maksimum (4-byte) dan `source`.
      source: 'countrylock' as const,
      stickers: longList(20, () => ({ stickerId: UUID, qty: SERIAL_LIMITS.stickerQtyMax })),
      // Foto bukti QC: lima id per baris (`SERIAL_PROOF_LIMITS.perEntryMax`).
      proofPhotoIds: longList(SERIAL_PROOF_LIMITS.perEntryMax, () => UUID),
    })),
  },
  'serials.update': {
    id: UUID,
    expectedUpdatedAt: STAMP,
    serial: 'S'.repeat(SERIAL_LIMITS.serialMax),
    itemId: UUID,
    testDate: '2026-11-12',
    sample: true,
    note: '\u6f22'.repeat(SERIAL_LIMITS.noteMax),
    locationId: UUID,
  },
  'serials.updateBatch': {
    rows: longList(SERIAL_LIMITS.batchRows, () => ({
      id: UUID,
      expectedUpdatedAt: STAMP,
      fields: {
        serial: 'S'.repeat(SERIAL_LIMITS.serialMax),
        itemId: UUID,
        testDate: '2026-11-12',
        sample: true,
        note: '\u6f22'.repeat(SERIAL_LIMITS.noteMax),
        locationId: UUID,
      },
    })),
  },
  'serials.act': {
    id: UUID,
    expectedUpdatedAt: STAMP,
    // Terburuk: cek ulang tidak lolos (field terbanyak) dengan pesan 4-byte per karakter dan 20 stiker tercentang.
    action: 'recheck_fail',
    occurredOn: '2026-11-12',
    message: '\u{1F600}'.repeat(SERIAL_LIMITS.messageMax),
    stickerIds: longList(SERIAL_LIMITS.picksMax, () => UUID),
    proofPhotoIds: longList(SERIAL_PROOF_LIMITS.perEntryMax, () => UUID),
  },
  'serials.applyStickersBatch': {
    clientId: UUID,
    occurredOn: '2026-11-12',
    message: '\u{1F600}'.repeat(SERIAL_LIMITS.messageMax),
    rows: longList(BATCH_MAX, (index) => ({
      id: `${'i'.repeat(50)}-${index}`,
      stickerIds: longList(SERIAL_LIMITS.picksMax, () => UUID),
    })),
  },
  'serials.lookupMany': {
    serials: longList(SERIAL_LIMITS.batchRows, () => 'S'.repeat(SERIAL_LIMITS.serialMax)),
  },
  'serialWarehouse.lookup': {
    serials: longList(WAREHOUSE_LIMITS.lookupMax, () => 'S'.repeat(SERIAL_LIMITS.serialMax)),
    ids: longList(WAREHOUSE_LIMITS.lookupMax, (index) => `${'i'.repeat(90)}-${index}`),
    orderId: UUID,
  },
  'serialWarehouse.submit': {
    clientId: UUID,
    chunkIndex: 0,
    header: {
      dispatchedOn: '2026-11-26',
      orderNumber: text(WAREHOUSE_LIMITS.orderNumberMax),
      buId: UUID,
      customerName: text(255),
      itemId: UUID,
      note: '\u{1F600}'.repeat(WAREHOUSE_LIMITS.noteMax),
      handoverIds: longList(WAREHOUSE_LIMITS.handoverLinksMax, (index) => `${UUID}-${index}`),
      total: WAREHOUSE_LIMITS.chunkMax,
      chunkSize: WAREHOUSE_LIMITS.chunkMax,
    },
    rows: longList(WAREHOUSE_LIMITS.chunkMax, (index) => ({
      kind: 'new' as const,
      clientId: UUID,
      serial: 'S'.repeat(SERIAL_LIMITS.serialMax),
      locationId: `${UUID}-${index}`,
      testDate: '2026-11-26',
    })),
  },
  'serialWarehouse.setLinks': {
    id: UUID,
    expectedUpdatedAt: STAMP,
    handoverIds: longList(WAREHOUSE_LIMITS.handoverLinksMax, (index) => `${UUID}-${index}`),
  },
  'serials.reportNew': {
    serial: 'S'.repeat(SERIAL_LIMITS.serialMax),
    itemId: UUID,
    buId: UUID,
    locationId: UUID,
    message: '\u{1F600}'.repeat(SERIAL_LIMITS.messageMax),
    occurredOn: '2026-11-14',
  },
  // Konfigurasi lokasi servis: lokasi aktif sebanyak-banyaknya (jauh di atas data nyata).
  'serialServiceSettings.save': {
    expectedUpdatedAt: STAMP,
    locationIds: longList(500, () => UUID),
  },
  'postels.save': {
    id: UUID,
    expectedUpdatedAt: STAMP,
    note: text(POSTEL_LIMITS.noteMax),
    itemIds: longList(POSTEL_LIMITS.itemsMax, () => UUID),
    numbers: longList(POSTEL_LIMITS.numbersMax, () => ({
      id: UUID,
      number: text(POSTEL_LIMITS.numberMax),
      expiresOn: '2100-12-31',
      link: text(POSTEL_LIMITS.linkMax),
    })),
    attachmentIds: longList(POSTEL_LIMITS.attachmentsMax, () => UUID),
  },
  // 20 penerima sepanjang 254 karakter (batas alamat).
  'serialSettings.save': {
    expectedUpdatedAt: STAMP,
    alert: {
      enabled: true,
      cc: [],
      bcc: [],
      recipients: longList(
        SERIAL_LIMITS.alertRecipientsMax,
        (index) => `${'x'.repeat(240 - String(index).length)}${index}@abcdefgh.com`,
      ),
    },
  },
  'postelSettings.save': {
    expectedUpdatedAt: STAMP,
    alert: {
      enabled: true,
      cc: [],
      bcc: [],
      recipients: longList(
        POSTEL_LIMITS.recipientsMax,
        (index) => `u${index}-${'x'.repeat(40)}@contoh.com`,
      ),
      sendHour: 23,
      thresholds: [730, 365, 90, 30, 1],
      repeatEveryDays: POSTEL_LIMITS.repeatDaysMax,
    },
  },
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
    buId: UUID,
    namePlacement: 'footer',
  },
  'qrcodes.clonePreset': { id: UUID, buId: UUID, name: text(QR_LIMITS.presetName) },
  'qrcodes.saveLogoLibrary': {
    expectedUpdatedAt: STAMP,
    logoFileIds: longList(QR_LIMITS.logoLibrary, () => UUID),
  },
  'qrcodes.cloneFromDrive': { source: text(2000), replaceDocumentId: UUID },
  'serialProofs.retry': { id: UUID },
  'serialProofs.replace': { photoId: UUID, newPhotoId: UUID },
  'notifications.markRead': { id: UUID },
  'notifications.markAllRead': {},
  'desktop.handoff': {},
  'push.subscribe': { endpoint: text(2000), p256dh: text(200), auth: text(100) },
  'push.unsubscribe': { endpoint: text(2000) },
  'push.setPreference': { enabled: true },
  'push.deviceState': { endpoint: text(2000) },
  'push.setDeviceMuted': { endpoint: text(2000), muted: true },
  'push.reportPermission': { state: 'granted' },
  'guides.mark': { id: text(100), version: 1 },
  'guides.reset': { id: text(100) },
  'exports.sheets': { tables: longList(50, () => text(100)) },
  // Dashboard: 30 widget (maks.) masing-masing dengan dua filter grup berisi 20 nilai terpanjang, plus filter global penuh.
  'dashboard.query': {
    filter: {
      buIds: longList(20, (index) => `${UUID}-${index}`),
      locationIds: longList(20, (index) => `${UUID}-${index}`),
      from: '2026-01-01',
      to: '2026-12-31',
    },
    widgets: longList(30, () => ({
      id: 'hs.created' as const,
      filters: {
        customer: longList(20, () => text(100)),
        status: longList(20, () => text(100)),
      },
    })),
  },
  // Tautan dashboard publik: judul terpanjang, 30 widget masing-masing dengan dua filter grup berisi 20 nilai terpanjang.
  'dashboardShares.create': {
    title: text(120),
    filter: {
      buIds: longList(20, (index) => `${UUID}-${index}`),
      locationIds: longList(20, (index) => `${UUID}-${index}`),
      from: '2026-01-01',
      to: '2026-12-31',
    },
    locationFiltered: true,
    range: { mode: 'fixed', from: '2026-01-01', to: '2026-12-31' },
    widgets: longList(30, () => ({
      id: 'hs.created' as const,
      filters: {
        customer: longList(20, () => text(100)),
        status: longList(20, () => text(100)),
      },
    })),
    offers: ['customer', 'item', 'stickerType', 'sticker'],
    expiresInDays: 365,
  },
  // Ubah tautan: isi sama dengan pembuatan ditambah id tautan.
  'dashboardShares.update': {
    id: UUID,
    title: text(120),
    filter: {
      buIds: longList(20, (index) => `${UUID}-${index}`),
      locationIds: longList(20, (index) => `${UUID}-${index}`),
      from: '2026-01-01',
      to: '2026-12-31',
    },
    locationFiltered: true,
    range: { mode: 'fixed', from: '2026-01-01', to: '2026-12-31' },
    widgets: longList(30, () => ({
      id: 'hs.created' as const,
      filters: {
        customer: longList(20, () => text(100)),
        status: longList(20, () => text(100)),
      },
    })),
    offers: ['customer', 'item', 'stickerType', 'sticker'],
    expiresInDays: 365,
  },
  'dashboardShares.revoke': { id: UUID },
  // Laporan terjadwal: nama terpanjang, 12 widget masing-masing dengan dua filter grup berisi 20 nilai terpanjang,
  // 20 penerima terpanjang (254 karakter), filter global penuh.
  'dashboardReports.save': {
    id: UUID,
    name: text(120),
    schedule: { frequency: 'monthly', hour: 23, weekday: 7, monthDay: 28 },
    period: 'lastMonth',
    filter: {
      buIds: longList(20, (index) => `${UUID}-${index}`),
      locationIds: longList(20, (index) => `${UUID}-${index}`),
      from: '2026-01-01',
      to: '2026-12-31',
    },
    locationFiltered: true,
    widgets: longList(12, () => ({
      id: 'hs.created' as const,
      filters: {
        customer: longList(20, () => text(100)),
        status: longList(20, () => text(100)),
      },
    })),
    offers: ['customer', 'item', 'stickerType', 'sticker'],
    recipients: longList(20, (index) => `${'a'.repeat(240)}${index}@x.id`),
    linkDays: 365,
    enabled: true,
    expectedUpdatedAt: STAMP,
  },
  'dashboardReports.setEnabled': { id: UUID, enabled: true },
  'dashboardReports.sendTest': { id: UUID },
  'access.users.setStatusBatch': { ids: BATCH_IDS, status: 'inactive' },
  'access.users.removeBatch': { ids: BATCH_IDS },
  'access.users.restoreBatch': { ids: BATCH_IDS },
  'access.users.restore': { id: UUID },
  'access.roles.removeBatch': { ids: BATCH_IDS },
  'access.roles.restoreBatch': { ids: BATCH_IDS },
  'access.roles.restore': { id: UUID },
  'access.locations.setStatusBatch': { ids: BATCH_IDS, status: 'inactive' },
  'access.locations.removeBatch': { ids: BATCH_IDS },
  'access.locations.restoreBatch': { ids: BATCH_IDS },
  'access.locations.restore': { id: UUID },
  'access.businessUnits.setStatusBatch': { ids: BATCH_IDS, status: 'inactive' },
  'access.businessUnits.removeBatch': { ids: BATCH_IDS },
  'access.businessUnits.restoreBatch': { ids: BATCH_IDS },
  'access.businessUnits.restore': { id: UUID },
  'customers.setStatusBatch': { ids: BATCH_IDS, status: 'inactive' },
  'customers.removeBatch': { ids: BATCH_IDS },
  'customers.restoreBatch': { ids: BATCH_IDS },
  'customers.restore': { id: UUID },
  'brands.restore': { id: UUID },
  'items.restore': { id: UUID },
  'serials.restore': { id: UUID },
  'qrcodes.restore': { id: UUID },
  'postels.restore': { id: UUID },
  'stickers.restore': { id: UUID },
  'stickerTypes.restore': { id: UUID },
  'qrcodes.restorePreset': { id: UUID },
};

const BODY_VERBS = new Set(['POST', 'PUT', 'PATCH']);

/** Id rute JSON bertubuh: bukan biner, verba tulis berbadan (termasuk varian `create`). */
function jsonBodyRouteIds(): ApiId[] {
  return (Object.keys(API_ROUTES) as ApiId[]).filter((id) => {
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
    for (const id of Object.keys(WORST) as ApiId[]) {
      const parts = toRequestParts(id, WORST[id] as never);
      const bytes = new TextEncoder().encode(JSON.stringify(parts.body ?? null)).length;
      sizes.push([id, bytes]);
      expect(bytes, id).toBeLessThan(MAX_JSON_BODY_BYTES);
    }
    // Invarian ruang minimal 2x berlaku untuk semua rute KECUALI `serials.saveBatch`.
    const SAVE_BATCH = 'serials.saveBatch';
    const max = Math.max(...sizes.filter(([id]) => id !== SAVE_BATCH).map(([, bytes]) => bytes));
    expect(max * 2).toBeLessThan(MAX_JSON_BODY_BYTES);
    // Pengecualian (keputusan pemilik 2026-11-13): 200 baris x catatan dan kerusakan sepenuhnya emoji 4-byte
    // (~1,29 MB, 61% batas) bukan skenario nyata, jadi margin 2x tidak dipaksakan. Batas atas konkret ~1,3 MB tetap
    // menangkap regresi ukuran (mis. baris atau batas karakter bertambah) sebelum menyentuh 2 MB.
    const saveBatchBytes = sizes.find(([id]) => id === SAVE_BATCH)?.[1] ?? 0;
    expect(saveBatchBytes).toBeGreaterThan(0);
    expect(saveBatchBytes).toBeLessThanOrEqual(1_300_000);
  });

  test('batas JSON 2 MB; batas global Bun.serve diturunkan dari tabel rute biner', () => {
    expect(MAX_JSON_BODY_BYTES).toBe(2 * 1024 * 1024);
    const binaryMax = Math.max(
      ...Object.values(API_ROUTES).flatMap((def) => [
        def.rawBody?.maxBytes ?? 0,
        def.multipart?.maxBytes ?? 0,
      ]),
    );
    // Terbesar = unggah gambar pustaka (gambar 10 MB + thumbnail 40 KB + 64 KB ruang multipart), di atas PDF QR 10 MB.
    expect(binaryMax).toBe(MAX_IMAGE_BYTES + GUIDE_LIMITS.thumbMaxBytes + 64 * 1024);
    expect(binaryMax).toBeGreaterThan(QR_LIMITS.documentMaxBytes);
    expect(MAX_REQUEST_BODY_BYTES).toBeGreaterThan(binaryMax);
    // Tanpa ketergantungan pada batas 16 MB lama: global = rute biner terbesar + overhead.
    expect(MAX_REQUEST_BODY_BYTES).toBe(binaryMax + 64 * 1024);
    expect(MAX_REQUEST_BODY_BYTES).toBeLessThan(16 * 1024 * 1024);
  });
});
