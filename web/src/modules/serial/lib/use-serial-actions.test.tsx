import type { MeDto, SerialDto } from '@shared/contract';
import type { SerialCustody, SerialStatus } from '@shared/serials';
import { renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import {
  primaryKindsOf,
  type SerialActionContext,
  type SerialActionKey,
  useSerialActions,
} from './use-serial-actions';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));

type Level = 'none' | 'view' | 'edit';

/** Pengguna dengan hak `serial` dan `serialservice` pada BU `b1`. */
function meWith(serial: Level, serialservice: Level): MeDto {
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
      serial,
      serialservice,
      countrylock: 'none',
      dashboard: 'none',
    },
    businessUnits: [
      {
        id: 'b1',
        code: 'BU1',
        name: 'Satu',
        status: 'active',
        permissions: { item: 'none', serial, serialservice },
      },
    ],
    locations: [],
  };
}

const ADMIN = meWith('edit', 'edit');
const QC_ONLY = meWith('edit', 'none');
const SERVICE_ONLY = meWith('view', 'edit');
const READER = meWith('view', 'none');

interface Run {
  /** Id aksi utama (tombol), urut. */
  primary: string[];
  /** Id aksi di menu "Aksi lainnya", urut. */
  menu: string[];
}

function run(
  context: SerialActionContext,
  status: SerialStatus,
  custody: SerialCustody,
  me: MeDto,
  extra: { hidden?: boolean } = {},
): Run {
  const serialPage = context === 'serial';
  const { result } = renderHook(() =>
    useSerialActions({
      me,
      context,
      subject: { status, custody, buId: 'b1' },
      serial: undefined as SerialDto | undefined,
      report: serialPage,
      onEdit: serialPage ? () => undefined : undefined,
      ...extra,
    }),
  );
  const visible = result.current.items.filter((item) => !item.hidden);
  return {
    primary: visible.filter((item) => item.primary).map((item) => item.id),
    menu: visible.filter((item) => !item.primary).map((item) => item.id),
  };
}

describe('detail Laporan (context case)', () => {
  test('Dilaporkan: Cek ulang + Kirim ke servis; Tempel stiker dan Catatan di menu', () => {
    expect(run('case', 'reported', 'qc', ADMIN)).toEqual({
      primary: ['flow-recheck', 'flow-send'],
      menu: ['stickers', 'flow-note'],
    });
  });

  test('dikirim ke tim servis (di servis, dalam pengiriman): Terima + Diagnosis; Catatan di menu', () => {
    expect(run('case', 'at_service', 'transit', ADMIN)).toEqual({
      primary: ['flow-receive', 'flow-diagnosis'],
      menu: ['flow-note'],
    });
  });

  test('sudah diterima di servis: hanya Diagnosis (tanpa Terima); Catatan di menu', () => {
    expect(run('case', 'at_service', 'service', ADMIN)).toEqual({
      primary: ['flow-diagnosis'],
      menu: ['flow-note'],
    });
  });

  test('diagnosis dan sedang diperbaiki: Diagnosis; Catatan di menu', () => {
    for (const status of ['diagnosis', 'service_repair'] as const) {
      expect(run('case', status, 'service', ADMIN)).toEqual({
        primary: ['flow-diagnosis'],
        menu: ['flow-note'],
      });
    }
  });

  test('dikembalikan ke QC (dalam pengiriman): Terima di QC + Cek ulang; Catatan di menu', () => {
    const state = run('case', 'recheck', 'transit', ADMIN);
    expect(state.primary).toEqual(['flow-receive', 'flow-recheck']);
    expect(state.menu).toEqual(['flow-note']);
  });

  test('sudah diterima QC (menunggu cek ulang): Cek ulang; Tempel stiker dan Catatan di menu', () => {
    expect(run('case', 'recheck', 'qc', ADMIN)).toEqual({
      primary: ['flow-recheck'],
      menu: ['stickers', 'flow-note'],
    });
  });

  test('tanpa Lapor rusak dan Ubah data di detail Laporan', () => {
    const { primary, menu } = run('case', 'reported', 'qc', ADMIN);
    expect([...primary, ...menu]).not.toContain('report');
    expect([...primary, ...menu]).not.toContain('edit');
  });

  test('tim servis saja (tanpa serial: edit) di dikirim ke servis: Terima + Diagnosis; Catatan di menu', () => {
    expect(run('case', 'at_service', 'transit', SERVICE_ONLY)).toEqual({
      primary: ['flow-receive', 'flow-diagnosis'],
      menu: ['flow-note'],
    });
  });

  test('QC saja (tanpa serialservice) di dikirim ke servis: tak ada aksi servis; tak ada yang dipaksa menjadi utama', () => {
    const state = run('case', 'at_service', 'transit', QC_ONLY);
    expect(state.primary).toEqual([]);
    expect(state.menu).not.toContain('flow-diagnosis');
  });

  test('pengguna tanpa hak edit sama sekali: tidak ada aksi', () => {
    for (const status of ['reported', 'at_service', 'recheck'] as const) {
      expect(run('case', status, 'qc', READER)).toEqual({ primary: [], menu: [] });
    }
  });
});

describe('detail Serial (context serial)', () => {
  test('Lolos: Lapor rusak + Ubah data; Tempel stiker, Cek ulang, Catatan di menu', () => {
    expect(run('serial', 'good', 'qc', ADMIN)).toEqual({
      primary: ['report', 'edit'],
      menu: ['stickers', 'flow-recheck', 'flow-note'],
    });
  });

  test('Dilaporkan: Cek ulang + Kirim ke servis; Ubah data, Tempel stiker, Catatan di menu', () => {
    expect(run('serial', 'reported', 'qc', ADMIN)).toEqual({
      primary: ['flow-recheck', 'flow-send'],
      menu: ['edit', 'stickers', 'flow-note'],
    });
  });

  test('di servis (dikirim, diterima, diagnosis, diperbaiki) dan menunggu cek ulang: Ubah data; semua aksi alur di menu', () => {
    expect(run('serial', 'at_service', 'transit', ADMIN)).toEqual({
      primary: ['edit'],
      menu: ['flow-receive', 'flow-diagnosis', 'flow-note'],
    });
    expect(run('serial', 'at_service', 'service', ADMIN)).toEqual({
      primary: ['edit'],
      menu: ['flow-diagnosis', 'flow-note'],
    });
    expect(run('serial', 'diagnosis', 'service', ADMIN)).toEqual({
      primary: ['edit'],
      menu: ['flow-diagnosis', 'flow-note'],
    });
    expect(run('serial', 'service_repair', 'service', ADMIN)).toEqual({
      primary: ['edit'],
      menu: ['flow-diagnosis', 'flow-note'],
    });
    expect(run('serial', 'recheck', 'transit', ADMIN)).toEqual({
      primary: ['edit'],
      menu: ['flow-receive', 'flow-recheck', 'flow-note'],
    });
    expect(run('serial', 'recheck', 'qc', ADMIN)).toEqual({
      primary: ['edit'],
      menu: ['stickers', 'flow-recheck', 'flow-note'],
    });
  });

  test('Rusak: hanya Ubah data (tanpa aksi alur yang dipaksa)', () => {
    const state = run('serial', 'broken', 'qc', ADMIN);
    expect(state.primary).toEqual(['edit']);
    expect(state.menu).not.toContain('report');
  });

  test('tim servis saja di dikirim ke servis: tanpa Ubah data, aksi utama = Terima + Diagnosis; Catatan di menu', () => {
    expect(run('serial', 'at_service', 'transit', SERVICE_ONLY)).toEqual({
      primary: ['flow-receive', 'flow-diagnosis'],
      menu: ['flow-note'],
    });
  });

  test('QC saja di status Lolos: sama dengan admin (Lapor rusak + Ubah data)', () => {
    expect(run('serial', 'good', 'qc', QC_ONLY).primary).toEqual(['report', 'edit']);
  });

  test('pengguna tanpa hak edit sama sekali: tidak ada aksi', () => {
    for (const status of ['good', 'reported', 'at_service'] as const) {
      expect(run('serial', status, 'qc', READER)).toEqual({ primary: [], menu: [] });
    }
  });

  test('hidden (serial terhapus): tidak ada aksi sama sekali', () => {
    expect(run('serial', 'good', 'qc', ADMIN, { hidden: true })).toEqual({
      primary: [],
      menu: [],
    });
  });

  test('aksi utama paling banyak tiga', () => {
    for (const status of ['good', 'reported', 'at_service', 'recheck'] as const) {
      expect(run('serial', status, 'qc', ADMIN).primary.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('primaryKindsOf (murni)', () => {
  const all: SerialActionKey[] = [
    'report',
    'edit',
    'stickers',
    'send',
    'receive',
    'diagnosis',
    'recheck',
    'note',
  ];

  test('hanya memuat aksi yang tersedia, urut bobot', () => {
    expect(primaryKindsOf('case', { status: 'reported' }, ['note', 'send', 'recheck'])).toEqual([
      'recheck',
      'send',
    ]);
    expect(primaryKindsOf('case', { status: 'recheck' }, ['recheck', 'receive'])).toEqual([
      'receive',
      'recheck',
    ]);
  });

  test('tanpa aksi yang tersedia: kosong (bukan dipaksa)', () => {
    for (const context of ['serial', 'case'] as const) {
      expect(primaryKindsOf(context, { status: 'reported' }, [])).toEqual([]);
    }
  });

  test('serial Lolos tanpa Ubah data: hanya Lapor rusak', () => {
    expect(
      primaryKindsOf(
        'serial',
        { status: 'good' },
        all.filter((key) => key !== 'edit'),
      ),
    ).toEqual(['report']);
  });

  test('serial status lain tanpa hak ubah memakai bobot alur', () => {
    expect(
      primaryKindsOf('serial', { status: 'at_service' }, ['receive', 'diagnosis', 'note']),
    ).toEqual(['receive', 'diagnosis']);
  });
});
