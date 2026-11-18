import type { CatalogStatus } from '@countrylock/bridge-contract';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { createFakeBridge } from '../fake-bridge';
import { CatalogSyncButton, formatSyncedAt } from './catalog-sync-button';

// Tombol sinkron data offline di navbar desktop (keputusan pemilik 2026-11-18): pindahan dari panel "Katalog Tipe",
// kini dengan waktu sinkron terakhir, dan tampil di semua halaman (header AppShell dan header ringan /country-lock).

const OK: CatalogStatus = {
  state: 'ok',
  itemCount: 4,
  syncedAt: '2026-11-18T10:00:00.000Z',
  error: null,
};

function setup(status: CatalogStatus = OK) {
  const refresh = vi.fn(async () => OK);
  let notify: ((next: CatalogStatus) => void) | undefined;
  const bridge = createFakeBridge({
    catalog: {
      status: async () => status,
      refresh,
      onChange: (cb) => {
        notify = cb;
        return () => undefined;
      },
    },
  });
  const view = render(<CatalogSyncButton bridge={bridge} />);
  return { bridge, refresh, notify: (next: CatalogStatus) => notify?.(next), ...view };
}

describe('formatSyncedAt', () => {
  test('waktu sah diformat; kosong atau tak terbaca = null', () => {
    expect(formatSyncedAt('2026-11-18T10:00:00.000Z')).toEqual(expect.stringContaining('2026'));
    expect(formatSyncedAt(null)).toBeNull();
    expect(formatSyncedAt('')).toBeNull();
    expect(formatSyncedAt('bukan tanggal')).toBeNull();
  });
});

describe('CatalogSyncButton', () => {
  test('peramban (tanpa jembatan), jembatan lama, atau katalog nonaktif: tidak merender apa pun', async () => {
    const none = render(<CatalogSyncButton bridge={null} />);
    expect(none.container).toBeEmptyDOMElement();

    const old = createFakeBridge({ version: 4 });
    const spy = vi.spyOn(old.catalog, 'status');
    const legacy = render(<CatalogSyncButton bridge={old} />);
    expect(legacy.container).toBeEmptyDOMElement();
    expect(spy).not.toHaveBeenCalled();

    const disabled = setup({ ...OK, state: 'disabled', itemCount: 0, syncedAt: null });
    await waitFor(() => expect(disabled.container).toBeEmptyDOMElement());
  });

  test('menampilkan waktu sinkron terakhir; menekan tombol memanggil refresh', async () => {
    const { refresh } = setup();
    const button = await screen.findByRole('button', { name: 'Sinkronkan katalog' });
    expect(button).toHaveTextContent(/Sinkron terakhir: .*2026/);
    await userEvent.click(button);
    expect(refresh).toHaveBeenCalledOnce();
  });

  test('status syncing: teks berubah dan tombol nonaktif; selesai: kembali aktif', async () => {
    const { notify } = setup();
    await screen.findByRole('button', { name: 'Sinkronkan katalog' });
    act(() => notify({ ...OK, state: 'syncing' }));
    const busy = await screen.findByRole('button', { name: 'Sinkronkan katalog' });
    expect(busy).toHaveTextContent('Menyinkronkan...');
    expect(busy).toBeDisabled();
    act(() => notify(OK));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sinkronkan katalog' })).toBeEnabled(),
    );
  });

  test('belum pernah sinkron: teks "Belum pernah sinkron"', async () => {
    setup({ state: 'error', itemCount: 0, syncedAt: null, error: 'UNAVAILABLE' });
    expect(await screen.findByRole('button', { name: 'Sinkronkan katalog' })).toHaveTextContent(
      'Belum pernah sinkron',
    );
  });

  test('galat sinkron: penjelasan sesuai jenisnya ada di title; data tersimpan tetap dipakai', async () => {
    const { notify } = setup();
    await screen.findByRole('button', { name: 'Sinkronkan katalog' });
    act(() => notify({ ...OK, state: 'error', error: 'UNAVAILABLE' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sinkronkan katalog' })).toHaveAttribute(
        'title',
        expect.stringContaining('Tidak dapat terhubung ke server'),
      ),
    );
    act(() => notify({ ...OK, state: 'error', error: 'REJECTED' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sinkronkan katalog' })).toHaveAttribute(
        'title',
        expect.stringContaining('Server menolak sinkron'),
      ),
    );
  });
});
