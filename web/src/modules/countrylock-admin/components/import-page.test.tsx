import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ImportClInput, ImportClResult } from '@shared/contract';
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

function fixtureFiles(): File[] {
  const files: File[] = [];
  for (const folder of ['MIKROTIK', 'UBIQUITI']) {
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
const importCalls = () => apiMock.mock.calls.filter((call) => call[0] === 'clImport.run');

describe('ImportPage', () => {
  test('memilih config.QC dan skrip menampilkan ringkasan; Impor mengirim satu panggilan clImport.run', async () => {
    await page();
    const [config, scripts] = await pickers();
    await userEvent.upload(config as HTMLInputElement, configFile());
    await userEvent.upload(scripts as HTMLInputElement, fixtureFiles());
    expect(await screen.findByText(/17 firmware/)).toBeTruthy();
    expect(screen.getByText(/17 skrip/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Impor' }));
    await waitFor(() => expect(importCalls()).toHaveLength(1));
    const sent = importCalls()[0]?.[1] as ImportClInput;
    expect(sent.firmwares).toHaveLength(17);
    expect(sent.scripts).toHaveLength(17);
    expect(sent.settings.router.ip).toBe('192.168.88.2');
    // Laporan hasil.
    expect(await screen.findByText(/18 berkas dibuat/)).toBeTruthy();
    expect(screen.getByText(/17 firmware dikaitkan/)).toBeTruthy();
  });

  test('masalah dari parser tampil dan tombol Impor tetap dapat dipakai (hanya peringatan)', async () => {
    await page();
    const [config, scripts] = await pickers();
    await userEvent.upload(config as HTMLInputElement, configFile());
    const withoutAc = fixtureFiles().filter((file) => file.name !== 'mikrotik-ac.txt');
    await userEvent.upload(scripts as HTMLInputElement, withoutAc);
    expect(await screen.findByText(/mikrotik-ac\.txt/)).toBeTruthy();
    expect(screen.getByText(/IP komputer/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Impor' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
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
    await userEvent.click(await screen.findByRole('button', { name: 'Impor' }));
    await waitFor(() => expect(importCalls()).toHaveLength(2));
    const [first, second] = importCalls().map((call) => call[1] as ImportClInput);
    expect(first?.scripts).toHaveLength(100);
    expect(second?.scripts).toHaveLength(20);
    expect(first?.firmwares).toHaveLength(0);
    expect(second?.firmwares).toHaveLength(120);
    expect(first?.settings).toEqual(second?.settings);
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
    await userEvent.click(await screen.findByRole('button', { name: 'Impor' }));
    expect(await screen.findByText('Berkas sudah ada dengan isi berbeda; dilewati')).toBeTruthy();
  });
});
