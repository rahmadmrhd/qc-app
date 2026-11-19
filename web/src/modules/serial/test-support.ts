import type { MeDto } from '@shared/contract';
import { addSerials, type StagingRow } from './lib/draft';

/** Bahan tes tampilan draft (tabel, kartu, dialog). Hanya dipakai berkas `*.test.tsx`. */
export const TEST_ITEMS = [
  { id: 'i1', label: 'Cisco C9200', buIds: ['b1'], buOptions: [{ id: 'b1', code: 'BU1' }] },
  { id: 'i2', label: 'Aruba 2930', buIds: ['b1'], buOptions: [{ id: 'b1', code: 'BU1' }] },
  {
    id: 'i3',
    label: 'Strict Router',
    buIds: ['b1'],
    buOptions: [{ id: 'b1', code: 'BU1' }],
    proofRequired: true,
    proofMin: 3,
  },
];

export const TEST_STICKERS: Record<string, { id: string; name: string }[]> = {
  i1: [{ id: 's1', name: 'Stiker A' }],
  i2: [{ id: 's3', name: 'Stiker C' }],
  i3: [{ id: 's4', name: 'Stiker D' }],
};

export function testMe(): MeDto {
  return {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    sharedAccount: false,
    canManageSerialSettings: false,
    permissions: {
      access: 'none',
      item: 'none',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'none',
      stickerstock: 'none',
      serial: 'edit',
      serialservice: 'none',
      countrylock: 'none',
    },
    businessUnits: [],
    locations: [],
  };
}

/** Implementasi `api` untuk opsi item, lokasi, dan stiker; id lain ditolak. */
export function optionsApi(id: string, input: Record<string, unknown>): Promise<unknown> {
  if (id === 'serials.locationOptions') {
    return Promise.resolve({
      locations: [
        { id: 'l1', code: 'JKT', name: 'Jakarta' },
        { id: 'l2', code: 'SBY', name: 'Surabaya' },
      ],
    });
  }
  if (id === 'serials.buOptions') {
    return Promise.resolve({
      businessUnits: [
        { id: 'b1', code: 'BU1', name: 'Business Unit 1' },
        { id: 'b2', code: 'BU2', name: 'Business Unit 2' },
      ],
    });
  }
  if (id === 'serials.itemOptions') {
    const ids = input.itemIds as string[] | undefined;
    return Promise.resolve({
      items: ids ? TEST_ITEMS.filter((item) => ids.includes(item.id)) : TEST_ITEMS,
      nextCursor: null,
    });
  }
  if (id === 'serials.stickerOptions') {
    const list = TEST_STICKERS[String(input.itemId)];
    if (!list) return Promise.reject(new Error('tidak ditemukan'));
    return Promise.resolve({
      stickers: list.map((sticker) => ({
        ...sticker,
        alias: '',
        typeName: 'Jenis',
        defaultQty: 1,
      })),
    });
  }
  if (id === 'serialProofs.remove') return Promise.resolve({ id: input.id });
  return Promise.reject(new Error(`api tak dikenal: ${id}`));
}

/** Baris draft dari Default Cisco C9200 / BU1 / Jakarta; `over` menimpa kolom. */
export function makeRow(serial: string, over: Partial<StagingRow> = {}): StagingRow {
  const [row] = addSerials(
    [],
    serial,
    {
      itemId: 'i1',
      itemLabel: 'Cisco C9200',
      buId: 'b1',
      buLabel: 'BU1',
      testDate: '2026-11-12',
      locationId: 'l1',
      locationLabel: 'Jakarta (JKT)',
      sample: false,
      note: '',
    },
    () => `id-${serial}`,
    () => '2026-11-12T10:00:00.000Z',
  ).rows;
  if (!row) throw new Error('seed');
  return { ...row, ...over };
}

export function proofRef(id: string) {
  return { id, mime: 'image/webp', size: 1, thumbUrl: `/api/v1/serial-proofs/${id}` };
}
