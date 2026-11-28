import type { ClFileDto, ClFirmwareDto, MeDto } from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installIntersectionObserver } from '@/test/intersection-observer';
import { makeMe } from '@/test/make-me';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { FirmwarePage } from './firmware-page';

function firmware(id: string, code: string, overrides: Partial<ClFirmwareDto> = {}): ClFirmwareDto {
  return {
    id,
    brand: 'mikrotik',
    code,
    label: `Label ${code}`,
    scriptPath: `MIKROTIK/${code}.txt`,
    parallel: false,
    sort: 10,
    inUseCount: 0,
    updatedAt: '2026-11-28T01:00:00.000Z',
    ...overrides,
  };
}

function file(id: string, path: string, role: ClFileDto['role'] = 'script'): ClFileDto {
  return {
    id,
    path,
    role,
    kind: 'text',
    headRev: 1,
    size: 1,
    sha256: 'a'.repeat(64),
    updatedAt: '2026-11-28T01:00:00.000Z',
    updatedBy: 'x',
    removed: false,
  };
}

let firmwares: ClFirmwareDto[];

beforeEach(() => {
  installIntersectionObserver();
  me = makeMe({ permissions: { countrylock: 'manage' } });
  firmwares = [
    firmware('f1', 'AC', { inUseCount: 3, parallel: true }),
    firmware('f2', 'AX', { scriptPath: null }),
  ];
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string, input: Record<string, unknown>) => {
    if (id === 'clFirmwares.list') return firmwares;
    if (id === 'clFiles.list') {
      return [
        file('s1', 'MIKROTIK/AC.txt'),
        file('s2', 'MIKROTIK/baru.txt'),
        file('r1', 'firmware/system.npk', 'router'),
        file('st', 'settings.json', 'settings'),
      ];
    }
    if (id === 'clFiles.get') {
      if (input.id === 's2') {
        return {
          ...file('s2', 'MIKROTIK/baru.txt'),
          text: [
            '/tool fetch url="{ipServer}" src-path=/temp/system.npk',
            '/import file-name=/temp/belum.cfg',
            ':put "{ipTarget} {bogus}"',
          ].join('\n'),
        };
      }
      return { ...file(String(input.id), 'MIKROTIK/AC.txt'), text: '# kosong' };
    }
    if (id === 'clFirmwares.save') return { ...firmware('fn', String(input.code)), ...input };
    if (id === 'clFirmwares.remove') return null;
    throw new Error(`api tak terduga: ${id}`);
  });
});

const page = () => renderInRouter(<FirmwarePage />);

describe('FirmwarePage', () => {
  test('daftar firmware: kode, skrip (atau belum ada), paralel, dan jumlah item pemakai', async () => {
    await page();
    expect(await screen.findByText('Label AC')).toBeTruthy();
    expect(screen.getByText('MIKROTIK/AC.txt')).toBeTruthy();
    expect(screen.getByText('Belum ada skrip')).toBeTruthy();
    expect(screen.getByText('3 item')).toBeTruthy();
  });

  test('hapus firmware yang dipakai item: dialog menyebut jumlah item dan tombol Hapus nonaktif dengan alasan', async () => {
    await page();
    await userEvent.click(await screen.findByRole('button', { name: 'Hapus AC' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Dipakai 3 item/)).toBeTruthy();
    expect(within(dialog).getByText(/pindahkan atau ubah firmware item itu dulu/i)).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: 'Hapus' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(apiMock).not.toHaveBeenCalledWith('clFirmwares.remove', expect.anything());
  });

  test('hapus firmware yang tidak dipakai: tombol aktif dan memanggil clFirmwares.remove', async () => {
    await page();
    await userEvent.click(await screen.findByRole('button', { name: 'Hapus AX' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Tidak dipakai item mana pun/)).toBeTruthy();
    expect(within(dialog).queryByText(/Dipakai 0 item/)).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('clFirmwares.remove', { id: 'f2' }));
  });

  test('pemegang edit TIDAK melihat Hapus firmware, tetapi dapat Ubah', async () => {
    me = makeMe({ permissions: { countrylock: 'edit' } });
    await page();
    await screen.findByText('Label AC');
    expect(screen.queryByRole('button', { name: 'Hapus AC' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ubah AC' })).toBeTruthy();
  });

  test('Tambah firmware: skrip dipilih dari berkas role skrip saja, lalu clFirmwares.save', async () => {
    await page();
    await userEvent.click(await screen.findByRole('button', { name: 'Tambah firmware' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByLabelText(/Kode/), 'NEW');
    await userEvent.type(within(dialog).getByLabelText(/Label/), 'Firmware baru');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Skrip' }));
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent);
    expect(options).toEqual(expect.arrayContaining(['MIKROTIK/AC.txt', 'MIKROTIK/baru.txt']));
    expect(options).not.toContain('firmware/system.npk');
    expect(options).not.toContain('settings.json');
    await userEvent.click(screen.getByRole('option', { name: 'MIKROTIK/baru.txt' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /paralel/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        'clFirmwares.save',
        expect.objectContaining({
          brand: 'mikrotik',
          code: 'NEW',
          label: 'Firmware baru',
          scriptPath: 'MIKROTIK/baru.txt',
          parallel: true,
        }),
      ),
    );
    const sent = apiMock.mock.calls.find((call) => call[0] === 'clFirmwares.save')?.[1] as {
      id?: string;
    };
    expect(sent.id).toBeUndefined();
  });

  test('Ubah firmware mengirim id dan expectedUpdatedAt', async () => {
    await page();
    await userEvent.click(await screen.findByRole('button', { name: 'Ubah AX' }));
    const dialog = await screen.findByRole('alertdialog');
    const label = within(dialog).getByLabelText(/Label/);
    await userEvent.clear(label);
    await userEvent.type(label, 'AX baru');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        'clFirmwares.save',
        expect.objectContaining({
          id: 'f2',
          label: 'AX baru',
          expectedUpdatedAt: '2026-11-28T01:00:00.000Z',
        }),
      ),
    );
  });

  test('firmware berkode spasi (mis. Mantbox 19s) dapat diubah labelnya walau kodenya terkunci', async () => {
    firmwares = [firmware('f9', 'Mantbox 19s', { inUseCount: 2 })];
    await page();
    await userEvent.click(await screen.findByRole('button', { name: 'Ubah Mantbox 19s' }));
    const dialog = await screen.findByRole('alertdialog');
    const label = within(dialog).getByLabelText(/Label/);
    await userEvent.clear(label);
    await userEvent.type(label, 'Mantbox baru');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        'clFirmwares.save',
        expect.objectContaining({ id: 'f9', code: 'Mantbox 19s', label: 'Mantbox baru' }),
      ),
    );
  });

  test('kode sepanjang batas server (40 karakter) diterima', async () => {
    await page();
    await userEvent.click(await screen.findByRole('button', { name: 'Tambah firmware' }));
    const dialog = await screen.findByRole('alertdialog');
    const code = within(dialog).getByLabelText(/Kode/) as HTMLInputElement;
    expect(code.maxLength).toBe(40);
    await userEvent.type(within(dialog).getByLabelText(/Label/), 'Panjang');
    await userEvent.type(code, 'K'.repeat(40));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        'clFirmwares.save',
        expect.objectContaining({ code: 'K'.repeat(40) }),
      ),
    );
  });

  test('memilih skrip menampilkan placeholder dan berkas /temp yang dirujuk; yang belum ada dapat diunggah', async () => {
    await page();
    await userEvent.click(await screen.findByRole('button', { name: 'Tambah firmware' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Skrip' }));
    await userEvent.click(await screen.findByRole('option', { name: 'MIKROTIK/baru.txt' }));
    const refs = await within(dialog).findByRole('region', { name: 'Isi skrip yang dirujuk' });
    expect(await within(refs).findByText('/temp/system.npk')).toBeTruthy();
    expect(within(refs).getByText(/Ada: firmware\/system\.npk/)).toBeTruthy();
    expect(within(refs).getByText('/temp/belum.cfg')).toBeTruthy();
    expect(within(refs).getByText('Belum ada di bundel')).toBeTruthy();
    expect(within(refs).getByText('{ipTarget}')).toBeTruthy();
    expect(within(refs).getByText(/\{bogus\} tidak dikenal/)).toBeTruthy();
    await userEvent.click(within(refs).getByRole('button', { name: 'Unggah belum.cfg' }));
    const upload = await screen.findByLabelText(/Nama berkas di bundel/);
    expect((upload as HTMLInputElement).value).toBe('belum.cfg');
  });
});
