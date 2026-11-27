import type { AuditEntryDto, MeDto } from '@shared/contract';
import { expect, test } from 'vitest';
import { whMe } from '@/modules/serialwh/lib/test-support';
import { makeMe } from '@/test/make-me';
import { auditTargetLink } from './audit-link';

type Kind = NonNullable<AuditEntryDto['targetRef']>['kind'];

const entry = (kind: Kind | undefined, id = 'x1'): Pick<AuditEntryDto, 'targetRef'> =>
  kind ? { targetRef: { kind, id } } : {};

const me = (permissions: Parameters<typeof makeMe>[0] = {}): MeDto => makeMe(permissions);

test('tanpa targetRef (entri lama atau aksi tanpa entitas): tanpa tautan', () => {
  expect(
    auditTargetLink(entry(undefined), me({ permissions: { access: 'manage' } })),
  ).toBeUndefined();
});

test('pengguna belum dimuat: tanpa tautan', () => {
  expect(auditTargetLink(entry('user'), undefined)).toBeUndefined();
  expect(auditTargetLink(entry('user'), null)).toBeUndefined();
});

test('akses (pengguna, role, lokasi, BU) menaut ke View bila access: view', () => {
  const viewer = me({ permissions: { access: 'view' } });
  expect(auditTargetLink(entry('user', 'u1'), viewer)).toEqual({
    to: '/access/users/$userId',
    params: { userId: 'u1' },
  });
  expect(auditTargetLink(entry('role', 'r1'), viewer)).toEqual({
    to: '/access/roles/$roleId',
    params: { roleId: 'r1' },
  });
  expect(auditTargetLink(entry('location', 'l1'), viewer)).toEqual({
    to: '/access/locations/$locationId',
    params: { locationId: 'l1' },
  });
  expect(auditTargetLink(entry('businessUnit', 'b1'), viewer)).toEqual({
    to: '/access/business-units/$businessUnitId',
    params: { businessUnitId: 'b1' },
  });
  const none = me({ permissions: { access: 'none' } });
  for (const kind of ['user', 'role', 'location', 'businessUnit'] as const) {
    expect(auditTargetLink(entry(kind), none), kind).toBeUndefined();
  }
});

test('item, merk, dan customer menaut bila item: view; tanpa izin item tanpa tautan', () => {
  const viewer = me({ itemLevel: 'view' });
  expect(auditTargetLink(entry('item', 'i1'), viewer)).toEqual({
    to: '/item/$itemId',
    params: { itemId: 'i1' },
  });
  expect(auditTargetLink(entry('brand', 'b1'), viewer)).toEqual({
    to: '/item/brands/$brandId',
    params: { brandId: 'b1' },
  });
  expect(auditTargetLink(entry('customer', 'c1'), viewer)).toEqual({
    to: '/customer/$customerId',
    params: { customerId: 'c1' },
  });
  const none = me({ itemLevel: 'none' });
  for (const kind of ['item', 'brand', 'customer'] as const) {
    expect(auditTargetLink(entry(kind), none), kind).toBeUndefined();
  }
});

test('Postel menaut bila sticker: view', () => {
  expect(auditTargetLink(entry('postel', 'p1'), me({ permissions: { sticker: 'view' } }))).toEqual({
    to: '/postel/$postelId',
    params: { postelId: 'p1' },
  });
  expect(
    auditTargetLink(entry('postel'), me({ permissions: { sticker: 'none' } })),
  ).toBeUndefined();
});

test('desain QR butuh qrcode: edit dan preset QR butuh qrcode: manage (hanya punya halaman ubah)', () => {
  const editor = me({ permissions: { qrcode: 'edit' } });
  expect(auditTargetLink(entry('qrDesign', 'd1'), editor)).toEqual({
    to: '/qrcode/$designId/edit',
    params: { designId: 'd1' },
  });
  expect(auditTargetLink(entry('qrPreset', 'p1'), editor)).toBeUndefined();
  expect(
    auditTargetLink(entry('qrPreset', 'p1'), me({ permissions: { qrcode: 'manage' } })),
  ).toEqual({
    to: '/qrcode/default/$presetId/edit',
    params: { presetId: 'p1' },
  });
  expect(
    auditTargetLink(entry('qrDesign'), me({ permissions: { qrcode: 'view' } })),
  ).toBeUndefined();
});

test('stiker dan jenis stiker tak punya halaman lihat: tanpa tautan', () => {
  const admin = me({ itemLevel: 'manage', permissions: { sticker: 'manage', access: 'manage' } });
  expect(auditTargetLink(entry('sticker'), admin)).toBeUndefined();
  expect(auditTargetLink(entry('stickerType'), admin)).toBeUndefined();
});

test('serial menaut bila serial atau serialservice: view (izin global)', () => {
  expect(auditTargetLink(entry('serial', 's1'), me({ permissions: { serial: 'view' } }))).toEqual({
    to: '/serial/$serialId',
    params: { serialId: 's1' },
  });
  expect(
    auditTargetLink(
      entry('serial', 's1'),
      me({ permissions: { serialservice: 'view', serialwh: 'none' } }),
    ),
  ).toBeDefined();
  expect(auditTargetLink(entry('serial'), me())).toBeUndefined();
});

test('serah terima menaut bila handover: view atau qc: edit di salah satu lokasi', () => {
  const withLocation = (permissions: Record<string, string>) => {
    const base = me();
    return {
      ...base,
      locations: [{ id: 'l1', code: 'JKT', name: 'Jakarta', permissions }],
    } as unknown as MeDto;
  };
  expect(auditTargetLink(entry('handover', 'h1'), withLocation({ handover: 'view' }))).toEqual({
    to: '/handover/$handoverId',
    params: { handoverId: 'h1' },
  });
  expect(auditTargetLink(entry('handover', 'h1'), withLocation({ qc: 'edit' }))).toBeDefined();
  expect(auditTargetLink(entry('handover', 'h1'), withLocation({ qc: 'view' }))).toBeUndefined();
  expect(auditTargetLink(entry('handover', 'h1'), me())).toBeUndefined();
});

test('catatan SO Keluar Gudang menaut ke detail Riwayat bila serialwh: view pada minimal satu BU', () => {
  expect(auditTargetLink(entry('warehouseOrder', 'o1'), whMe(['bu1']))).toEqual({
    to: '/serial/gudang/riwayat/so/$orderId',
    params: { orderId: 'o1' },
  });
  expect(auditTargetLink(entry('warehouseOrder', 'o1'), me())).toBeUndefined();
});
