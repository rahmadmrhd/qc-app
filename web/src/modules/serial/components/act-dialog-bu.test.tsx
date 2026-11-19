import type { MeDto, SerialDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { expectLinkValue, linkOptionNames, pickLink, pickSelect } from '@/test/link-field';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('@/modules/files/image', () => ({
  prepareImage: vi.fn(async () => ({
    mime: 'image/webp',
    bytes: new Uint8Array(3),
    width: 10,
    height: 10,
  })),
}));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));
// Editor Tiptap tidak dapat diketik di jsdom: diganti kolom teks.
vi.mock('@/modules/markdown/wysiwyg-editor', () => ({
  WysiwygEditor: (props: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    labelledBy?: string;
  }) => (
    <textarea
      id={props.id}
      aria-labelledby={props.labelledBy}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

import { ActDialog } from './act-dialog';

// Cek ulang lolos boleh sekaligus memindahkan BU (serial unik se-sistem, spek §1 butir 4 dan 6).

function meWith(): MeDto {
  const bu = (id: string, code: string) => ({
    id,
    code,
    name: code,
    status: 'active' as const,
    permissions: { item: 'none' as const, serial: 'edit' as const, serialservice: 'none' as const },
  });
  return {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    canManageSerialSettings: false,
    sharedAccount: false,
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
    businessUnits: [bu('b1', 'BU1'), bu('b2', 'BU2'), bu('b3', 'BU3')],
    locations: [],
  };
}

/** Serial yang pernah di BU1, kini di BU2 (BU1 sudah ditinggalkan dan terkunci). */
const MOVED: SerialDto = {
  buHistory: [
    {
      buId: 'b1',
      buCode: 'BU1',
      firstAt: '2026-11-01T00:00:00.000Z',
      leftAt: '2026-11-05T00:00:00.000Z',
    },
    { buId: 'b2', buCode: 'BU2', firstAt: '2026-11-05T00:00:00.000Z', leftAt: '' },
  ],
  id: 's1',
  buId: 'b2',
  buCode: 'BU2',
  serial: 'ABC123',
  itemId: 'i1',
  itemLabel: 'Cisco C9200',
  testDate: '2026-11-10',
  sample: false,
  locationId: 'l1',
  locationName: 'Jakarta',
  status: 'good',
  custody: 'qc',
  transitToLocationId: null,
  transitToLocationName: null,
  transitOn: null,
  openCaseNumber: null,
  createdAt: '2026-11-10T03:00:00.000Z',
  note: '',
  recordedLocationId: 'l1',
  stickers: [],
  hasProofPhotos: false,
  proofProblemCount: 0,
  openCaseId: null,
  transitFromLocationId: null,
  transitFromLocationName: null,
  openCase: null,
  cases: [],
  createdBy: 'budi@x.com',
  updatedAt: '2026-11-11T03:00:00.000Z',
  updatedBy: 'budi@x.com',
};

const CASE = {
  id: 'c1',
  number: 'LP/SBY/2611-0001',
  openedOn: '2026-11-13',
  closedOn: null,
  outcome: null,
} as const;
const REPORTED: SerialDto = {
  ...MOVED,
  status: 'reported',
  openCaseId: 'c1',
  openCaseNumber: CASE.number,
  openCase: CASE,
  cases: [CASE],
};

function renderDialog(serial: SerialDto) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ActDialog serial={serial} kind="recheck" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

const lastAct = () =>
  apiMock.mock.calls.filter((call) => call[0] === 'serials.act').at(-1)?.[1] as Record<
    string,
    unknown
  >;

beforeEach(() => {
  apiMock.mockReset();
  me = meWith();
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.act') return Promise.resolve({ ...MOVED, updatedAt: 'baru' });
    if (id === 'serials.buOptions') {
      return Promise.resolve({
        businessUnits: [
          { id: 'b1', code: 'BU1', name: 'BU1' },
          { id: 'b2', code: 'BU2', name: 'BU2' },
          { id: 'b3', code: 'BU3', name: 'BU3' },
        ],
      });
    }
    if (id === 'serials.stickerOptions') return Promise.resolve({ stickers: [] });
    if (id === 'serials.locationOptions') return Promise.resolve({ locations: [] });
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
});

test('Cek ulang lolos: field BU bawaan BU saat ini; BU yang pernah ditinggalkan tidak ditawarkan', async () => {
  renderDialog(MOVED);
  await expectLinkValue(screen, 'Business Unit', 'BU2');
  expect(await linkOptionNames(screen, 'Business Unit')).toEqual(['BU2', 'BU3']);
});

test('tanpa mengganti BU, buId tidak dikirim (kosong = BU saat ini)', async () => {
  renderDialog(MOVED);
  await expectLinkValue(screen, 'Business Unit', 'BU2');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  await waitFor(() => expect(lastAct()).toBeDefined());
  expect(lastAct()).toMatchObject({ action: 'recheck', result: 'pass' });
  expect(lastAct()).not.toHaveProperty('buId');
});

test('memilih BU lain pada hasil lolos mengirim buId', async () => {
  renderDialog(MOVED);
  await pickLink(screen, 'Business Unit', 'BU3');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  await waitFor(() => expect(lastAct()).toBeDefined());
  expect(lastAct()).toMatchObject({ action: 'recheck', result: 'pass', buId: 'b3' });
});

test('hasil tidak lolos menyembunyikan field BU dan tidak mengirim buId', async () => {
  renderDialog(MOVED);
  await pickLink(screen, 'Business Unit', 'BU3');
  await pickSelect(screen, 'Hasil cek ulang', 'Tidak lolos');
  expect(screen.queryByRole('combobox', { name: 'Business Unit' })).toBeNull();
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'Gagal lagi');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  await waitFor(() => expect(lastAct()).toBeDefined());
  expect(lastAct()).toMatchObject({ action: 'recheck', result: 'fail' });
  expect(lastAct()).not.toHaveProperty('buId');
});

test('Cek ulang pada Dilaporkan (recheck_pass) juga dapat memindahkan BU; recheck_fail tidak', async () => {
  const first = renderDialog(REPORTED);
  await pickLink(screen, 'Business Unit', 'BU3');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  await waitFor(() => expect(lastAct()).toBeDefined());
  expect(lastAct()).toMatchObject({ action: 'recheck_pass', buId: 'b3' });
  first.unmount();
  apiMock.mockClear();
  renderDialog(REPORTED);
  await pickSelect(screen, 'Hasil cek ulang', 'Tidak lolos');
  expect(screen.queryByRole('combobox', { name: 'Business Unit' })).toBeNull();
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'Masih mati');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));
  await waitFor(() => expect(lastAct()).toBeDefined());
  expect(lastAct()).toMatchObject({ action: 'recheck_fail' });
  expect(lastAct()).not.toHaveProperty('buId');
});

test('stiker dimuat dengan serialId serial yang dicek ulang (item nonaktif/tak terlihat tidak menghalangi)', async () => {
  renderDialog(MOVED);
  await expectLinkValue(screen, 'Business Unit', 'BU2');
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith('serials.stickerOptions', {
      itemId: 'i1',
      buId: 'b2',
      serialId: 's1',
    }),
  );
  // BU tujuan diganti: daftar stiker mengikuti BU tujuan, tetap dengan serialId yang sama.
  await pickLink(screen, 'Business Unit', 'BU3');
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith('serials.stickerOptions', {
      itemId: 'i1',
      buId: 'b3',
      serialId: 's1',
    }),
  );
});
