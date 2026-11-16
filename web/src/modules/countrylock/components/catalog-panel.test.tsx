import type { CatalogStatus } from '@countrylock/bridge-contract';
import type { DesktopCatalogDto } from '@shared/desktop-catalog';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { createFakeBridge } from '../fake-bridge';
import { CatalogPanel, filterCatalogItems } from './catalog-panel';

const OK: CatalogStatus = {
  state: 'ok',
  itemCount: 2,
  syncedAt: '2026-11-16T10:00:00.000Z',
  error: null,
};

const CATALOG: DesktopCatalogDto = {
  version: 1,
  items: [
    {
      id: 'i1',
      brand: 'Acme',
      model: 'AP-1',
      aliases: ['satu'],
      businessUnits: [{ id: 'bu1', code: 'DEF', name: 'Bawaan' }],
      stickerIds: ['s1'],
      stickerPhotos: [
        {
          guideId: 'g1',
          guideName: 'Depan',
          width: 800,
          height: 600,
          caption: 'Sisi depan',
          buId: null,
          marks: [
            {
              x: 100,
              y: 200,
              target: { kind: 'type', typeId: 't1' },
              note: 'kiri atas',
              targetName: 'Warranty',
              unresolved: false,
              resolved: [
                {
                  id: 's1',
                  name: 'Garansi',
                  alias: '',
                  fileId: 'f-s1',
                  buCodes: ['DEF'],
                  inactive: false,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'i2',
      brand: 'Beta',
      model: 'CPE-2',
      aliases: [],
      businessUnits: [],
      stickerIds: [],
      stickerPhotos: [],
    },
  ],
  stickerTypes: [{ id: 't1', name: 'Warranty', rule: 'bu', systemKind: '' }],
  stickers: [
    { id: 's1', typeId: 't1', name: 'Garansi', alias: '', fileId: 'f-s1', status: 'active' },
  ],
  files: [
    { id: 'g1', mime: 'image/png', size: 10 },
    { id: 'f-s1', mime: 'image/png', size: 10 },
  ],
};

function setup(
  status: CatalogStatus = OK,
  snapshot = { catalog: CATALOG, syncedAt: OK.syncedAt ?? '' },
) {
  const refresh = vi.fn(async () => OK);
  let notify: ((s: CatalogStatus) => void) | undefined;
  const bridge = createFakeBridge({
    catalog: {
      get: async () => snapshot,
      status: async () => status,
      refresh,
      onChange: (cb) => {
        notify = cb;
        return () => undefined;
      },
    },
  });
  const view = render(<CatalogPanel bridge={bridge} />);
  return { bridge, refresh, notify: (s: CatalogStatus) => notify?.(s), ...view };
}

describe('filterCatalogItems', () => {
  test('cocok merk, model, atau nama lain; tak peka huruf besar/kecil; kosong = semua', () => {
    expect(filterCatalogItems(CATALOG.items, '').map((item) => item.id)).toEqual(['i1', 'i2']);
    expect(filterCatalogItems(CATALOG.items, 'acme').map((item) => item.id)).toEqual(['i1']);
    expect(filterCatalogItems(CATALOG.items, 'cpe').map((item) => item.id)).toEqual(['i2']);
    expect(filterCatalogItems(CATALOG.items, 'SATU').map((item) => item.id)).toEqual(['i1']);
    expect(filterCatalogItems(CATALOG.items, 'tidak ada')).toEqual([]);
  });
});

describe('CatalogPanel', () => {
  test('katalog dinonaktifkan (build tanpa token): tidak tampil', async () => {
    const { container } = setup({ ...OK, state: 'disabled', itemCount: 0, syncedAt: null });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  test('jembatan lama (di bawah v5): tidak tampil dan tidak memanggil katalog', () => {
    const bridge = createFakeBridge({ version: 4 });
    const spy = vi.spyOn(bridge.catalog, 'status');
    const { container } = render(<CatalogPanel bridge={bridge} />);
    expect(container).toBeEmptyDOMElement();
    expect(spy).not.toHaveBeenCalled();
  });

  test('menampilkan status, daftar Tipe, dan mencari', async () => {
    setup();
    expect(await screen.findByText(/2 item · terakhir disinkronkan/)).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Daftar Tipe' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Cari Tipe' }), 'beta');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Cari Tipe' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Cari Tipe' }), 'zzz');
    expect(screen.getByText('Tidak ada Tipe yang cocok.')).toBeInTheDocument();
  });

  test('memilih Tipe menampilkan stiker yang berlaku dan instruksi dengan gambar dari cache lokal', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: /Acme AP-1/ }));
    const section = await screen.findByLabelText('Instruksi Acme AP-1');
    // Foto instruksi dan contoh stiker memakai /catalog-files/<id> (bukan REST /api/v1/files yang butuh sesi).
    const sources = [...section.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(sources).toContain('/catalog-files/g1');
    expect(sources).toContain('/catalog-files/f-s1');
    expect(sources.some((src) => src?.includes('/api/'))).toBe(false);
    expect(within(section).getByText('Sisi depan')).toBeInTheDocument();
    expect(within(section).getByRole('list', { name: 'Stiker yang berlaku' })).toBeInTheDocument();
    expect(within(section).getByText('kiri atas')).toBeInTheDocument();
    // Klik lagi menutup.
    await userEvent.click(screen.getByRole('button', { name: /Acme AP-1/ }));
    expect(screen.queryByLabelText('Instruksi Acme AP-1')).not.toBeInTheDocument();
  });

  test('tombol Sinkronkan memanggil refresh; status syncing menonaktifkannya', async () => {
    const { refresh, notify } = setup();
    await screen.findByText(/2 item/);
    await userEvent.click(screen.getByRole('button', { name: 'Sinkronkan katalog' }));
    expect(refresh).toHaveBeenCalledOnce();
    act(() => notify({ ...OK, state: 'syncing' }));
    expect(await screen.findByText('Menyinkronkan katalog...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sinkronkan katalog' })).toBeDisabled();
  });

  test('galat sinkron: pesan sesuai jenisnya; katalog tersimpan tetap tampil', async () => {
    const { notify } = setup();
    await screen.findByRole('list', { name: 'Daftar Tipe' });
    act(() => notify({ ...OK, state: 'error', error: 'UNAVAILABLE' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tidak dapat terhubung ke server');
    expect(screen.getByRole('list', { name: 'Daftar Tipe' })).toBeInTheDocument();
    act(() => notify({ ...OK, state: 'error', error: 'REJECTED' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Server menolak sinkron katalog');
  });

  test('belum pernah tersinkron: petunjuk tanpa daftar', async () => {
    const bridge = createFakeBridge({
      catalog: {
        get: async () => null,
        status: async () => ({
          state: 'error',
          itemCount: 0,
          syncedAt: null,
          error: 'UNAVAILABLE',
        }),
      },
    });
    render(<CatalogPanel bridge={bridge} />);
    expect(await screen.findByText(/Katalog belum pernah tersinkron/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Daftar Tipe' })).not.toBeInTheDocument();
  });

  test('sinkron sukses memuat ulang potret', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ catalog: CATALOG, syncedAt: OK.syncedAt ?? '' });
    let notify: ((s: CatalogStatus) => void) | undefined;
    const bridge = createFakeBridge({
      catalog: {
        get,
        status: async () => ({ ...OK, itemCount: 0, syncedAt: null }),
        onChange: (cb) => {
          notify = cb;
          return () => undefined;
        },
      },
    });
    render(<CatalogPanel bridge={bridge} />);
    await screen.findByText(/Katalog belum pernah tersinkron/);
    act(() => notify?.(OK));
    expect(await screen.findByRole('list', { name: 'Daftar Tipe' })).toBeInTheDocument();
  });
});
