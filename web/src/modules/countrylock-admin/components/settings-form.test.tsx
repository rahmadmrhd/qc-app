import type { ClFileDetailDto, ClFileDto } from '@shared/contract';
import { type ClSettings, parseSettingsFile } from '@shared/countrylock-bundle';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { installIntersectionObserver } from '@/test/intersection-observer';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

import { SettingsForm } from './settings-form';

const MODE = {
  ip: '',
  ipServer: '192.168.88.2',
  connectVia: 'Server',
  interfaceBridge: 'BridgeAll',
} as const;
const SETTINGS: ClSettings = {
  schema: 1,
  router: {
    ip: '192.168.88.2',
    username: 'admin',
    password: 'rahasia-polos',
    interfaceBridge: 'BridgeAll',
  },
  network: { computerIp: '192.168.88.3', prefixLength: 24 },
  brands: {
    mikrotik: {
      label: 'Mikrotik',
      username: 'admin',
      password: '',
      web: 'http://{ip}/',
      modes: { single: { ...MODE, ip: '192.168.88.1' }, multi: MODE },
    },
    ubiquiti: {
      label: 'Ubiquiti',
      username: 'ubnt',
      password: 'ubnt',
      web: 'https://{ip}/',
      modes: { single: { ...MODE, ip: '192.168.88.50', connectVia: 'Target' }, multi: MODE },
    },
  },
};

function listEntry(): ClFileDto {
  return {
    id: 'set1',
    path: 'settings.json',
    role: 'settings',
    kind: 'text',
    headRev: 2,
    size: 100,
    sha256: 'a'.repeat(64),
    updatedAt: '2026-11-28T01:00:00.000Z',
    updatedBy: 'admin@x.com',
    removed: false,
  };
}

let files: ClFileDto[];
let detail: ClFileDetailDto;
const onDone = vi.fn();

beforeEach(() => {
  installIntersectionObserver();
  onDone.mockReset();
  files = [listEntry()];
  detail = { ...listEntry(), text: `${JSON.stringify(SETTINGS, null, 2)}\n` };
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'clFiles.list') return files;
    if (id === 'clFiles.get') return detail;
    if (id === 'clFiles.save') return { ...detail, headRev: 3 };
    throw new Error(`api tak terduga: ${id}`);
  });
});

const form = () => renderInRouter(<SettingsForm onCancel={vi.fn()} onDone={onDone} />);
const saveCall = () =>
  apiMock.mock.calls.find((call) => call[0] === 'clFiles.save')?.[1] as
    | { text: string; baseSeq?: number; expectedUpdatedAt?: string; path: string; role: string }
    | undefined;

describe('SettingsForm', () => {
  test('kredensial router tampil polos (bukan field sandi bertopeng)', async () => {
    await form();
    const password = (await screen.findByLabelText('Sandi router')) as HTMLInputElement;
    expect(password.value).toBe('rahasia-polos');
    expect(password.type).toBe('text');
    expect((screen.getByLabelText('Alamat router jump') as HTMLInputElement).value).toBe(
      '192.168.88.2',
    );
  });

  test('mengubah IP router lalu Simpan menyimpan settings.json kanonik dengan baseSeq dan If-Match', async () => {
    await form();
    const ip = (await screen.findByLabelText('Alamat router jump')) as HTMLInputElement;
    await userEvent.clear(ip);
    await userEvent.type(ip, '192.168.88.9');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(saveCall()).toBeDefined());
    const sent = saveCall();
    expect(sent).toMatchObject({
      path: 'settings.json',
      role: 'settings',
      baseSeq: 2,
      expectedUpdatedAt: '2026-11-28T01:00:00.000Z',
    });
    const parsed = parseSettingsFile(sent?.text ?? '');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.settings.router.ip).toBe('192.168.88.9');
      expect(parsed.settings.router.password).toBe('rahasia-polos');
      expect(parsed.settings.brands.ubiquiti.modes.single.ip).toBe('192.168.88.50');
    }
    expect(sent?.text.endsWith('\n')).toBe(true);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  test('IP tak sah ditolak di klien dengan pesan dan tanpa memanggil server', async () => {
    await form();
    const ip = (await screen.findByLabelText('Alamat router jump')) as HTMLInputElement;
    await userEvent.clear(ip);
    await userEvent.type(ip, 'bukan-ip');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText(/router\.ip bukan alamat IPv4 yang sah/)).toBeTruthy();
    expect(saveCall()).toBeUndefined();
  });

  test('tab Mikrotik dan Ubiquiti memuat kredensial bawaan dan mode single/multi', async () => {
    await form();
    await userEvent.click(await screen.findByRole('tab', { name: 'Ubiquiti' }));
    expect(
      (await screen.findByLabelText('Username bawaan Ubiquiti')) as HTMLInputElement,
    ).toHaveProperty('value', 'ubnt');
    expect(
      (screen.getByLabelText('IP target mode single Ubiquiti') as HTMLInputElement).value,
    ).toBe('192.168.88.50');
  });

  test('revisi basi (412): dialog muat ulang dan isian tidak ditimpa', async () => {
    apiMock.mockImplementation(async (id: string) => {
      if (id === 'clFiles.list') return files;
      if (id === 'clFiles.get') return detail;
      throw new ApiError('CONFLICT', 'Data sudah diubah', '-', undefined, { status: 412 });
    });
    await form();
    const username = (await screen.findByLabelText('Username router')) as HTMLInputElement;
    await userEvent.clear(username);
    await userEvent.type(username, 'baru');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Pengaturan diubah orang lain')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tetap di sini' }));
    expect((screen.getByLabelText('Username router') as HTMLInputElement).value).toBe('baru');
  });

  test('settings.json belum ada: form bawaan yang valid dan Simpan membuat berkas tanpa baseSeq', async () => {
    files = [];
    apiMock.mockImplementation(async (id: string) => {
      if (id === 'clFiles.list') return files;
      if (id === 'clFiles.save') return { ...detail, headRev: 1 };
      throw new Error(`api tak terduga: ${id}`);
    });
    await form();
    await screen.findByLabelText('Alamat router jump');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(saveCall()).toBeDefined());
    expect(saveCall()?.baseSeq).toBeUndefined();
    expect(parseSettingsFile(saveCall()?.text ?? '').ok).toBe(true);
  });

  test('settings.json rusak di server: pesan jelas dan form tidak menyimpan apa pun', async () => {
    detail = { ...detail, text: '{ rusak' };
    await form();
    expect(await screen.findByText(/settings\.json di server tidak dapat dibaca/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Simpan' })).toBeNull();
  });
});
