import type { PendingEntry } from '@countrylock/pending';
import type { SaveSerialBatchInput, SerialRowResult } from '@shared/contract';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { createFakeBridge } from '../fake-bridge';
import { CountryLockPage } from './country-lock-page';

// Unggah antrean pending ke Daftar Serial Number (spek desktop §6.6, Fase 5).

const entry = (serial: string, extra: Partial<PendingEntry> = {}): PendingEntry => ({
  serial,
  brand: 'mikrotik',
  tipe: 'RB-750',
  date: '2026-11-18',
  timestamp: '2026-11-18T08:00:00.000Z',
  buId: 'bu-1',
  buLabel: 'DEF - BU',
  locationId: 'loc-1',
  locationLabel: 'QC-A - QC',
  itemId: 'item-1',
  clientId: `cid-${serial}-00000000`,
  ...extra,
});

function setup(
  entries: PendingEntry[],
  options: {
    signedIn?: boolean;
    version?: number;
    save?: (input: SaveSerialBatchInput) => Promise<{ results: SerialRowResult[] }>;
  } = {},
) {
  const bridge = createFakeBridge(
    options.version === undefined ? {} : { version: options.version },
  );
  bridge.pendingList.push(...entries);
  const save = vi.fn(
    options.save ??
      (async (input: SaveSerialBatchInput) => ({
        results: input.rows.map((row) => ({
          clientId: row.clientId,
          result: 'created' as const,
          message: '',
        })),
      })),
  );
  render(<CountryLockPage bridge={bridge} signedIn={options.signedIn ?? true} saveBatch={save} />);
  return { bridge, save };
}

const uploadButton = () => screen.findByRole('button', { name: /Unggah ke server/ });

describe('unggah antrean pending', () => {
  test('belum masuk: tombol nonaktif dengan alasan; tidak memanggil server', async () => {
    const { save } = setup([entry('AB12')], { signedIn: false });
    expect(await uploadButton()).toBeDisabled();
    expect(screen.getByText(/Masuk dulu untuk mengunggah/)).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  test('jembatan lama (di bawah v7): tombol nonaktif dengan alasan perbarui aplikasi', async () => {
    setup([entry('AB12')], { version: 6 });
    expect(await uploadButton()).toBeDisabled();
    expect(screen.getByText(/belum mendukung unggah/)).toBeInTheDocument();
  });

  test('tanpa entri yang siap (semua entri lama): tombol nonaktif dan tiap baris menyebut alasannya', async () => {
    setup([entry('OLD1', { itemId: undefined, clientId: undefined })]);
    expect(await uploadButton()).toBeDisabled();
    expect(await screen.findByText(/Dicatat tanpa Tipe katalog/)).toBeInTheDocument();
  });

  test('mengirim hanya entri yang siap sebagai baris countrylock; yang sukses dihapus, duplikat dan gagal tetap beserta alasan', async () => {
    const { bridge, save } = setup(
      [
        entry('OK1'),
        entry('DUP1'),
        entry('BAD1'),
        entry('OLD1', { itemId: undefined, clientId: undefined }),
      ],
      {
        save: async (input) => ({
          results: input.rows.map((row): SerialRowResult => {
            if (row.serial === 'DUP1') {
              return {
                clientId: row.clientId,
                result: 'duplicate',
                message: 'Serial sudah ada di BU ini',
              };
            }
            if (row.serial === 'BAD1') {
              return {
                clientId: row.clientId,
                result: 'invalid',
                message: 'Item ini wajib foto bukti minimal 1',
              };
            }
            return { clientId: row.clientId, result: 'created', message: '' };
          }),
        }),
      },
    );
    const button = await uploadButton();
    expect(button).toHaveTextContent('Unggah ke server (3)');
    await userEvent.click(button);

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const [input] = save.mock.calls[0] ?? [];
    expect(input?.rows.map((row) => row.serial)).toEqual(['OK1', 'DUP1', 'BAD1']);
    expect(input?.rows[0]).toMatchObject({
      source: 'countrylock',
      itemId: 'item-1',
      buId: 'bu-1',
      locationId: 'loc-1',
      testDate: '2026-11-18',
      sample: false,
    });

    // Yang sukses hilang dari antrean; sisanya tetap dengan alasan dari server.
    await waitFor(() =>
      expect(bridge.pendingList.map((e) => e.serial)).toEqual(['DUP1', 'BAD1', 'OLD1']),
    );
    expect(await screen.findByText('Serial sudah ada di BU ini')).toBeInTheDocument();
    expect(screen.getByText('Item ini wajib foto bukti minimal 1')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Hasil unggah: 1 terunggah, 1 duplikat, 1 gagal.',
    );
  });

  test('galat panggilan (mis. sesi berakhir): antrean utuh, alasan tampil, dan dapat dicoba lagi', async () => {
    let calls = 0;
    const { bridge, save } = setup([entry('AB12')], {
      save: async (input) => {
        calls += 1;
        if (calls === 1) throw new ApiError('UNAUTHENTICATED', 'Sesi berakhir', 'req-1');
        return {
          results: input.rows.map((row) => ({
            clientId: row.clientId,
            result: 'created' as const,
            message: '',
          })),
        };
      },
    });
    await userEvent.click(await uploadButton());
    expect(await screen.findByText(/Unggah berhenti: Sesi berakhir/)).toBeInTheDocument();
    expect(bridge.pendingList).toHaveLength(1);

    await userEvent.click(await uploadButton());
    await waitFor(() => expect(bridge.pendingList).toHaveLength(0));
    expect(save).toHaveBeenCalledTimes(2);
  });

  test('dua klik cepat hanya mengirim sekali', async () => {
    let release: (() => void) | undefined;
    const { save } = setup([entry('AB12')], {
      save: (input) =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              results: input.rows.map((row) => ({
                clientId: row.clientId,
                result: 'created' as const,
                message: '',
              })),
            });
        }),
    });
    const button = await uploadButton();
    await userEvent.click(button);
    await userEvent.click(button);
    expect(save).toHaveBeenCalledOnce();
    release?.();
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });

  test('Hapus meminta konfirmasi lalu membuang serial dari antrean', async () => {
    const { bridge } = setup([entry('AB12'), entry('CD34')]);
    await userEvent.click(await screen.findByRole('button', { name: 'Hapus AB12 dari antrean' }));
    const dialog = await screen.findByRole('alertdialog');
    // Batal tidak menghapus.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
    expect(bridge.pendingList).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Hapus AB12 dari antrean' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Hapus' }),
    );
    await waitFor(() => expect(bridge.pendingList.map((e) => e.serial)).toEqual(['CD34']));
  });
});
