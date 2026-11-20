import type { MeDto } from '@shared/contract';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mockMatchMedia } from '@/test/match-media';
import { ACTIVE_LOCATIONS_STORAGE_KEY } from '../active-locations';
import { ActiveLocationsProvider } from '../active-locations-context';
import { LocationField } from '../location-field';
import { LocationLine } from './location-line';
import {
  LAST_ACTIVE_KEY,
  LocationReconfirm,
  RECONFIRM_AFTER_MS,
  shouldReconfirm,
} from './location-reconfirm';
import { LocationSheet } from './location-sheet';

const none = { handover: 'none', qc: 'none', stock: 'none', stickerstock: 'none' } as const;
let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

let media: ReturnType<typeof mockMatchMedia>;
beforeEach(() => {
  localStorage.clear();
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  me = {
    email: 'a@x.com',
    name: 'A',
    isSuperAdmin: false,
    sharedAccount: false,
    canManageSerialSettings: false,
    permissions: {} as MeDto['permissions'],
    businessUnits: [],
    locations: [
      { id: 'l-a', code: 'JKT', name: 'Jakarta', permissions: { ...none, handover: 'edit' } },
      { id: 'l-b', code: 'BDG', name: 'Bandung', permissions: { ...none, handover: 'edit' } },
    ],
  };
});
afterEach(() => {
  media.restore();
  localStorage.clear();
  window.innerWidth = 1024;
});

const wrap = (node: React.ReactNode) =>
  render(<ActiveLocationsProvider>{node}</ActiveLocationsProvider>);

const noop = () => undefined;

test('baris lokasi: label, area tekan 44 px, dan membuka lembar pemilih', async () => {
  wrap(<LocationLine />);
  const button = screen.getByRole('button', { name: /Lokasi aktif: Semua lokasi/ });
  expect(button.className).toContain('after:-inset-y-3.5');
  await userEvent.click(button);
  expect(await screen.findByText('Terapkan (2)')).toBeInTheDocument();
});

test('lembar: Terapkan nonaktif bila kosong, Pilih semua mengisi, dan Terapkan menyimpan pilihan', async () => {
  localStorage.setItem(ACTIVE_LOCATIONS_STORAGE_KEY, JSON.stringify(['l-a']));
  wrap(<LocationSheet open onOpenChange={noop} />);
  await userEvent.click(screen.getByLabelText(/Jakarta/));
  expect(screen.getByRole('button', { name: 'Terapkan (0)' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Pilih semua' }));
  expect(screen.getByRole('button', { name: 'Terapkan (2)' })).toBeEnabled();
  await userEvent.click(screen.getByLabelText(/Bandung/));
  await userEvent.click(screen.getByRole('button', { name: 'Terapkan (1)' }));
  expect(JSON.parse(localStorage.getItem(ACTIVE_LOCATIONS_STORAGE_KEY) ?? '[]')).toEqual(['l-a']);
});

test('baris lokasi tanpa lokasi sama sekali tampil sebagai peringatan', () => {
  me = { ...me, locations: [] };
  wrap(<LocationLine />);
  expect(screen.getByRole('button', { name: /belum dipilih/ }).className).toContain(
    'text-warning-text',
  );
});

test('shouldReconfirm: tanpa penanda tidak; di bawah 4 jam tidak; 4 jam atau lebih ya', () => {
  const now = 10_000_000_000;
  expect(shouldReconfirm(null, now)).toBe(false);
  expect(shouldReconfirm(now - RECONFIRM_AFTER_MS + 1, now)).toBe(false);
  expect(shouldReconfirm(now - RECONFIRM_AFTER_MS, now)).toBe(true);
});

test('dialog konfirmasi lokasi: tidak muncul saat pertama kali, muncul setelah 4 jam, Sudah benar menyegarkan penanda', async () => {
  const first = wrap(<LocationReconfirm />);
  expect(screen.queryByText(/Apakah lokasi ini masih benar/)).toBeNull();
  expect(localStorage.getItem(LAST_ACTIVE_KEY)).not.toBeNull();
  first.unmount();

  const old = Date.now() - RECONFIRM_AFTER_MS - 1000;
  localStorage.setItem(LAST_ACTIVE_KEY, String(old));
  wrap(<LocationReconfirm />);
  expect(await screen.findByText(/Apakah lokasi ini masih benar/)).toBeInTheDocument();
  expect(screen.getByText(/Lokasi aktif: Semua lokasi/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Sudah benar' }));
  expect(Number(localStorage.getItem(LAST_ACTIVE_KEY))).toBeGreaterThan(old);
  expect(screen.queryByText(/Apakah lokasi ini masih benar/)).toBeNull();
});

test('dialog konfirmasi: kembali ke tab setelah lama memicu, Ganti membuka lembar pemilih', async () => {
  wrap(<LocationReconfirm />);
  localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now() - RECONFIRM_AFTER_MS - 1000));
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await userEvent.click(await screen.findByRole('button', { name: 'Ganti' }));
  expect(await screen.findByText(/Terapkan \(/)).toBeInTheDocument();
});

test('field lokasi form tulis: nilai awal disorot dengan keterangan sampai diubah', () => {
  me = { ...me, locations: me.locations.slice(0, 1) };
  const view = wrap(
    <LocationField
      id="loc"
      module="handover"
      level="edit"
      highlightInitial
      value="l-a"
      onChange={noop}
    />,
  );
  expect(screen.getByText(/Nilai awal diambil dari lokasi aktif/)).toBeInTheDocument();
  view.rerender(
    <ActiveLocationsProvider>
      <LocationField
        id="loc"
        module="handover"
        level="edit"
        highlightInitial
        value=""
        onChange={noop}
      />
    </ActiveLocationsProvider>,
  );
  expect(screen.queryByText(/Nilai awal diambil dari lokasi aktif/)).toBeNull();
});

test('field lokasi tanpa highlightInitial tidak menampilkan keterangan', () => {
  me = { ...me, locations: me.locations.slice(0, 1) };
  wrap(<LocationField id="loc" module="handover" level="edit" value="l-a" onChange={noop} />);
  expect(screen.queryByText(/Nilai awal diambil/)).toBeNull();
});
