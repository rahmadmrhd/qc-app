import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ImportClInput, ImportClResult } from '@shared/contract';
import { CL_TEXT_MAX_BYTES } from '@shared/countrylock-bundle';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installIntersectionObserver } from '@/test/intersection-observer';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

import { ImportPage } from './import-page';

const FIXTURE = join(__dirname, '../../../../../countrylock/fixtures/country-lock2');

function fixtureFiles(folders: readonly string[] = ['MIKROTIK', 'UBIQUITI']): File[] {
  const files: File[] = [];
  for (const folder of folders) {
    for (const name of readdirSync(join(FIXTURE, folder))) {
      files.push(new File([readFileSync(join(FIXTURE, folder, name))], name));
    }
  }
  return files;
}
const configFile = (text = readFileSync(join(FIXTURE, 'config.QC'), 'utf-8')) =>
  new File([text], 'config.QC');

const RESULT: ImportClResult = {
  filesCreated: 18,
  filesSkipped: 0,
  firmwaresLinked: 17,
  issues: [],
};
const onBack = vi.fn();

beforeEach(() => {
  installIntersectionObserver();
  onBack.mockReset();
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'clImport.run') return RESULT;
    throw new Error(`api tak terduga: ${id}`);
  });
});

const page = () => renderInRouter(<ImportPage onCancel={onBack} />);
const pickers = async () =>
  (await screen.findAllByTestId('file-picker-input')) as HTMLInputElement[];
const fillNetwork = async (computerIp = '192.168.88.9', prefix = '24') => {
  await userEvent.clear(screen.getByLabelText(/IP komputer/));
  await userEvent.type(screen.getByLabelText(/IP komputer/), computerIp);
  await userEvent.clear(screen.getByLabelText(/Panjang prefix/));
  await userEvent.type(screen.getByLabelText(/Panjang prefix/), prefix);
};
const importButton = () => screen.getByRole('button', { name: 'Impor' }) as HTMLButtonElement;
const importCalls = () => apiMock.mock.calls.filter((call) => call[0] === 'clImport.run');

describe('ImportPage', () => {
  test('memilih config.QC dan skrip menampilkan ringkasan; Impor mengirim satu panggilan clImport.run', async () => {
    await page();
    const [config, scripts] = await pickers();
    await userEvent.upload(config as HTMLInputElement, configFile());
    await userEvent.upload(scripts as HTMLInputElement, fixtureFiles());
    expect(await screen.findByText(/17 firmware/)).toBeTruthy();
    expect(screen.getByText(/17 skrip/)).toBeTruthy();
    await fillNetwork();
    await userEvent.click(screen.getByRole('button', { name: 'Impor' }));
    await waitFor(() => expect(importCalls()).toHaveLength(1));
    const sent = importCalls()[0]?.[1] as ImportClInput;
    expect(sent.firmwares).toHaveLength(17);
    expect(sent.scripts).toHaveLength(17);
    expect(sent.settings.router.ip).toBe('192.168.88.2');
    expect(sent.settings.network).toEqual({ computerIp: '192.168.88.9', prefixLength: 24 });
    // Laporan hasil.
    expect(await screen.findByText(/18 berkas dibuat/)).toBeTruthy();
    expect(screen.getByText(/17 firmware dikaitkan/)).toBeTruthy();
  });

  test('Impor nonaktif sampai IP komputer dan prefix diisi sah; tak ada tebakan bawaan', async () => {
    await page();
    const [config, scripts] = await pickers();
    await userEvent.upload(config as HTMLInputElement, configFile());
    await userEvent.upload(scripts as HTMLInputElement, fixtureFiles());
    expect(await screen.findByText(/17 firmware/)).toBeTruthy();
    expect((screen.getByLabelText(/IP komputer/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/Panjang prefix/) as HTMLInputElement).value).toBe('');
    expect(importButton().disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/IP komputer/), '300.1.1.1');
    await userEvent.type(screen.getByLabelText(/Panjang prefix/), '24');
    expect(await screen.findByText(/bukan alamat IPv4 yang sah/)).toBeTruthy();
    expect(importButton().disabled).toBe(true);
    await userEvent.clear(screen.getByLabelText(/IP komputer/));
    await userEvent.type(screen.getByLabelText(/IP komputer/), '192.168.88.9');
    await userEvent.clear(screen.getByLabelText(/Panjang prefix/));
    await userEvent.type(screen.getByLabelText(/Panjang prefix/), '40');
    expect(await screen.findByText(/bilangan bulat 1-32/)).toBeTruthy();
    expect(importButton().disabled).toBe(true);
    await userEvent.clear(screen.getByLabelText(/Panjang prefix/));
    await userEvent.type(screen.getByLabelText(/Panjang prefix/), '24');
    expect(importButton().disabled).toBe(false);
    expect(importCalls()).toHaveLength(0);
  });

  test('masalah dari parser tampil dan tombol Impor dapat dipakai bila jaringan terisi (hanya peringatan)', async () => {
    await page();
    const [config, scripts] = await pickers();
    await userEvent.upload(config as HTMLInputElement, configFile());
    const withoutAc = fixtureFiles().filter((file) => file.name !== 'mikrotik-ac.txt');
    await userEvent.upload(scripts as HTMLInputElement, withoutAc);
    expect(await screen.findByText(/mikrotik-ac\.txt/)).toBeTruthy();
    await fillNetwork();
    expect(importButton().disabled).toBe(false);
  });

  test('config.QC rusak: pesan galat dan Impor nonaktif', async () => {
    await page();
    const [config] = await pickers();
    await userEvent.upload(config as HTMLInputElement, configFile('{ rusak'));
    expect(await screen.findByText(/config\.QC bukan JSON yang valid/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Impor' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  test('tanpa config.QC: Impor nonaktif', async () => {
    await page();
    expect(
      ((await screen.findByRole('button', { name: 'Impor' })) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test('impor besar dipecah: firmware hanya di panggilan terakhir dan laporan digabung', async () => {
    const firmware: Record<string, { label: string; file: string }> = {};
    const scripts: File[] = [];
    for (let index = 0; index < 120; index += 1) {
      firmware[`F${index}`] = { label: `F${index}`, file: `f${index}.txt` };
      scripts.push(new File([`# skrip ${index}`], `f${index}.txt`));
    }
    const config = JSON.stringify({
      server: { ip: '192.168.88.2', interfaceBridge: 'BridgeAll' },
      mikrotik: { folder: 'MIKROTIK', firmware },
    });
    apiMock.mockImplementation(async (id: string) => {
      if (id === 'clImport.run') {
        return { filesCreated: 60, filesSkipped: 0, firmwaresLinked: 0, issues: [] };
      }
      throw new Error(`api tak terduga: ${id}`);
    });
    await page();
    const [configInput, scriptsInput] = await pickers();
    await userEvent.upload(configInput as HTMLInputElement, configFile(config));
    await userEvent.upload(scriptsInput as HTMLInputElement, scripts);
    await screen.findByRole('button', { name: 'Impor' });
    await fillNetwork();
    await userEvent.click(importButton());
    await waitFor(() => expect(importCalls()).toHaveLength(2));
    const [first, second] = importCalls().map((call) => call[1] as ImportClInput);
    expect(first?.scripts).toHaveLength(100);
    expect(second?.scripts).toHaveLength(20);
    expect(first?.firmwares).toHaveLength(0);
    expect(second?.firmwares).toHaveLength(120);
    expect(first?.settings).toEqual(second?.settings);
    expect(first?.settings.network.computerIp).toBe('192.168.88.9');
    expect(await screen.findByText(/120 berkas dibuat/)).toBeTruthy();
  });

  test('temuan dari server ditampilkan di laporan', async () => {
    apiMock.mockImplementation(async (id: string) => {
      if (id === 'clImport.run') {
        return {
          ...RESULT,
          issues: [
            {
              severity: 'warning',
              code: 'IMPORT_CONTENT_DIFFERS',
              path: 'MIKROTIK/mikrotik-ac.txt',
              message: 'Berkas sudah ada dengan isi berbeda; dilewati',
            },
          ],
        };
      }
      throw new Error(`api tak terduga: ${id}`);
    });
    await page();
    const [config, scripts] = await pickers();
    await userEvent.upload(config as HTMLInputElement, configFile());
    await userEvent.upload(scripts as HTMLInputElement, fixtureFiles());
    await screen.findByRole('button', { name: 'Impor' });
    await fillNetwork();
    await userEvent.click(importButton());
    expect(await screen.findByText('Berkas sudah ada dengan isi berbeda; dilewati')).toBeTruthy();
  });
});

describe('ImportPage: beberapa folder dan batas ukuran', () => {
  test('pilihan berikutnya MENAMBAH (folder MIKROTIK lalu UBIQUITI), bukan mengganti', async () => {
    await page();
    const [config, scripts] = await pickers();
    await userEvent.upload(config as HTMLInputElement, configFile());
    await userEvent.upload(scripts as HTMLInputElement, fixtureFiles(['MIKROTIK']));
    expect(await screen.findByText(/8 skrip/)).toBeTruthy();
    await userEvent.upload(scripts as HTMLInputElement, fixtureFiles(['UBIQUITI']));
    expect(await screen.findByText(/17 firmware, 17 skrip siap diimpor/)).toBeTruthy();
    expect(screen.getByText('Pilihan 1')).toBeTruthy();
    expect(screen.getByText('Pilihan 2')).toBeTruthy();
    await fillNetwork();
    await userEvent.click(screen.getByRole('button', { name: 'Impor' }));
    await waitFor(() => expect(importCalls()).toHaveLength(1));
    const sent = importCalls()[0]?.[1] as ImportClInput | undefined;
    expect(sent?.scripts).toHaveLength(17);
  });

  test('berkas dapat dihapus dari daftar terpilih, juga satu pilihan sekaligus', async () => {
    await page();
    const [config, scripts] = await pickers();
    await userEvent.upload(config as HTMLInputElement, configFile());
    await userEvent.upload(scripts as HTMLInputElement, fixtureFiles(['MIKROTIK']));
    await userEvent.upload(scripts as HTMLInputElement, fixtureFiles(['UBIQUITI']));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Hapus skrip mikrotik-ac.txt' }),
    );
    expect(await screen.findByText(/16 skrip siap diimpor/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Hapus Pilihan 2' }));
    expect(await screen.findByText(/7 skrip siap diimpor/)).toBeTruthy();
  });

  test('nama berkas sama dengan isi berbeda di dua pilihan dilaporkan sebagai masalah', async () => {
    await page();
    const [config, scripts] = await pickers();
    await userEvent.upload(config as HTMLInputElement, configFile());
    await userEvent.upload(scripts as HTMLInputElement, fixtureFiles(['MIKROTIK']));
    await userEvent.upload(scripts as HTMLInputElement, [new File(['# lain'], 'mikrotik-ac.txt')]);
    expect(await screen.findByText(/mikrotik-ac\.txt dipilih lebih dari satu kali/)).toBeTruthy();
  });

  test('skrip lebih besar dari batas ditolak tanpa dibaca dan alasannya tampil', async () => {
    await page();
    const [config, scripts] = await pickers();
    await userEvent.upload(config as HTMLInputElement, configFile());
    const big = new File(['x'.repeat(CL_TEXT_MAX_BYTES + 1)], 'besar.txt');
    const textSpy = vi.spyOn(big, 'text');
    await userEvent.upload(scripts as HTMLInputElement, [big]);
    expect(await screen.findByText(/besar\.txt.*melebihi batas/)).toBeTruthy();
    expect(textSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Hapus skrip besar.txt' })).toBeNull();
  });

  test('config.QC yang terlalu besar ditolak tanpa dibaca', async () => {
    await page();
    const [config] = await pickers();
    const big = new File(['x'.repeat(600 * 1024)], 'config.QC');
    const textSpy = vi.spyOn(big, 'text');
    await userEvent.upload(config as HTMLInputElement, big);
    expect(await screen.findByText(/config\.QC.*melebihi batas/)).toBeTruthy();
    expect(textSpy).not.toHaveBeenCalled();
  });
});
