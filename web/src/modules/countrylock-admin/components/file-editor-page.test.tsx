import type { ClFileDetailDto, ClRevisionDetailDto, ClRevisionDto } from '@shared/contract';
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

// Editor dan diff dimuat malas di aplikasi nyata; di tes diganti tiruan sederhana.
vi.mock('./code-editor', () => ({
  CodeEditor: ({
    value,
    onChange,
    label,
    readOnly,
  }: {
    value: string;
    onChange?: (value: string) => void;
    label: string;
    readOnly?: boolean;
  }) => (
    <textarea
      aria-label={label}
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));
vi.mock('./diff-view', () => ({
  DiffView: ({ original, modified }: { original: string; modified: string }) => (
    <div data-testid="diff">{`${original} => ${modified}`}</div>
  ),
}));

import { FileEditorPage } from './file-editor-page';

function detail(overrides: Partial<ClFileDetailDto> = {}): ClFileDetailDto {
  return {
    id: 'f1',
    path: 'MIKROTIK/mikrotik-ac.txt',
    role: 'script',
    kind: 'text',
    headRev: 3,
    size: 11,
    sha256: 'a'.repeat(64),
    updatedAt: '2026-11-28T01:00:00.000Z',
    updatedBy: 'admin@x.com',
    removed: false,
    text: 'isi lama',
    ...overrides,
  };
}

const REVISIONS: ClRevisionDto[] = [
  {
    seq: 1,
    sha256: 'b'.repeat(64),
    size: 4,
    message: 'Berkas dibuat',
    author: 'admin@x.com',
    createdAt: '2026-11-26T01:00:00.000Z',
  },
  {
    seq: 2,
    sha256: 'c'.repeat(64),
    size: 8,
    message: '',
    author: 'admin@x.com',
    createdAt: '2026-11-27T01:00:00.000Z',
  },
  {
    seq: 3,
    sha256: 'a'.repeat(64),
    size: 11,
    message: 'Tambah bridge',
    author: 'admin@x.com',
    createdAt: '2026-11-28T01:00:00.000Z',
  },
];

let current: ClFileDetailDto;
const onBack = vi.fn();

beforeEach(() => {
  installIntersectionObserver();
  current = detail();
  onBack.mockReset();
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string, input: Record<string, unknown>) => {
    if (id === 'clFiles.get') return current;
    if (id === 'clFiles.history') return REVISIONS;
    if (id === 'clFiles.revision') {
      const seq = Number(input.seq);
      return {
        ...REVISIONS.find((revision) => revision.seq === seq),
        text: `teks ${seq}`,
      } as ClRevisionDetailDto;
    }
    if (id === 'clFiles.save') {
      // Server menyimpan lalu `clFiles.get` berikutnya mengembalikan revisi baru itu.
      current = {
        ...current,
        headRev: 4,
        updatedAt: '2026-11-28T02:00:00.000Z',
        text: String(input.text),
      };
      return current;
    }
    if (id === 'clFiles.revert') return { ...current, headRev: 4, text: 'teks 1' };
    if (id === 'clFiles.remove') return null;
    throw new Error(`api tak terduga: ${id}`);
  });
});

const page = () => renderInRouter(<FileEditorPage fileId="f1" onBack={onBack} />);
const editor = async () =>
  (await screen.findByLabelText('Isi MIKROTIK/mikrotik-ac.txt')) as HTMLTextAreaElement;

describe('FileEditorPage: menyunting dan menyimpan', () => {
  test('memuat isi terbaru ke editor; Simpan nonaktif sampai ada perubahan', async () => {
    await page();
    expect((await editor()).value).toBe('isi lama');
    const save = screen.getByRole('button', { name: 'Simpan' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await userEvent.type(await editor(), '!');
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Simpan' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
  });

  test('Simpan mengirim baseSeq dan expectedUpdatedAt dari revisi yang dilihat, plus catatan', async () => {
    await page();
    await userEvent.type(await editor(), ' baru');
    await userEvent.type(screen.getByLabelText(/Catatan perubahan/), 'Tambah bridge');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('clFiles.save', {
        path: 'MIKROTIK/mikrotik-ac.txt',
        role: 'script',
        text: 'isi lama baru',
        message: 'Tambah bridge',
        baseSeq: 3,
        expectedUpdatedAt: '2026-11-28T01:00:00.000Z',
      }),
    );
    // Simpan berikutnya memakai revisi hasil simpan (4) sebagai dasar.
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Simpan' }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    await userEvent.type(await editor(), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        'clFiles.save',
        expect.objectContaining({ baseSeq: 4, expectedUpdatedAt: '2026-11-28T02:00:00.000Z' }),
      ),
    );
  });

  test('412: dialog muat ulang tampil dan teks yang sedang disunting TIDAK ditimpa', async () => {
    apiMock.mockImplementation(async (id: string) => {
      if (id === 'clFiles.get') return current;
      if (id === 'clFiles.save') {
        throw new ApiError('CONFLICT', 'Data sudah diubah', '-', undefined, { status: 412 });
      }
      throw new Error(`api tak terduga: ${id}`);
    });
    await page();
    await userEvent.type(await editor(), ' suntingan saya');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Berkas diubah orang lain')).toBeTruthy();
    // Tetap di sini: dialog tertutup, suntingan tetap utuh.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tetap di sini' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect((await editor()).value).toBe('isi lama suntingan saya');
  });

  test('412 lalu Muat ulang: suntingan dibuang dan revisi server terpasang', async () => {
    let attempts = 0;
    apiMock.mockImplementation(async (id: string) => {
      if (id === 'clFiles.get') {
        return attempts === 0 ? current : detail({ headRev: 4, text: 'isi dari orang lain' });
      }
      if (id === 'clFiles.save') {
        attempts += 1;
        throw new ApiError('CONFLICT', 'Data sudah diubah', '-', undefined, { status: 412 });
      }
      throw new Error(`api tak terduga: ${id}`);
    });
    await page();
    await userEvent.type(await editor(), ' x');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await userEvent.click(await screen.findByRole('button', { name: /Muat ulang/ }));
    await waitFor(async () => expect((await editor()).value).toBe('isi dari orang lain'));
  });

  test('konflik nama (409) bukan basi: tampil sebagai galat biasa, tanpa dialog muat ulang', async () => {
    apiMock.mockImplementation(async (id: string) => {
      if (id === 'clFiles.get') return current;
      if (id === 'clFiles.save') throw new ApiError('CONFLICT', 'Nama berkas bentrok', '-');
      throw new Error(`api tak terduga: ${id}`);
    });
    await page();
    await userEvent.type(await editor(), ' x');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() =>
      expect(apiMock.mock.calls.some((call) => call[0] === 'clFiles.save')).toBe(true),
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('settings.json: editor baca-saja dan tanpa Simpan', async () => {
    current = detail({ path: 'settings.json', role: 'settings', text: '{}' });
    await page();
    const area = (await screen.findByLabelText('Isi settings.json')) as HTMLTextAreaElement;
    expect(area.readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: 'Simpan' })).toBeNull();
    expect(screen.getByText(/Pengaturan Router/)).toBeTruthy();
  });
});

describe('FileEditorPage: riwayat', () => {
  test('tab Riwayat memuat revisi; Kembalikan memanggil clFiles.revert', async () => {
    await page();
    await userEvent.click(await screen.findByRole('tab', { name: 'Riwayat' }));
    expect(await screen.findByText('Tambah bridge')).toBeTruthy();
    expect(screen.getByText('Berkas dibuat')).toBeTruthy();
    // Revisi terbaru tidak punya tombol kembalikan.
    expect(screen.queryByRole('button', { name: 'Kembalikan revisi 3' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Kembalikan revisi 1' }));
    // Pengembalian membuat revisi baru, jadi harus dikonfirmasi dulu.
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Kembalikan' }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('clFiles.revert', {
        id: 'f1',
        seq: 1,
        baseSeq: 3,
        expectedUpdatedAt: '2026-11-28T01:00:00.000Z',
      }),
    );
  });

  test('Bandingkan menampilkan selisih dua revisi yang dipilih', async () => {
    await page();
    await userEvent.click(await screen.findByRole('tab', { name: 'Riwayat' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bandingkan' }));
    // Bawaan: revisi sebelumnya (2) dengan terbaru (3).
    expect(await screen.findByTestId('diff')).toHaveProperty('textContent', 'teks 2 => teks 3');
    expect(
      apiMock.mock.calls.filter((call) => call[0] === 'clFiles.revision').map((call) => call[1]),
    ).toEqual(
      expect.arrayContaining([
        { id: 'f1', seq: '2' },
        { id: 'f1', seq: '3' },
      ]),
    );
  });
});

describe('FileEditorPage: berkas biner', () => {
  beforeEach(() => {
    current = detail({
      path: 'firmware/system.npk',
      role: 'router',
      kind: 'binary',
      text: null,
      size: 5_000_000,
    });
  });

  test('hanya tab Riwayat, daftar versi dengan hash, dan aksi unggah versi baru', async () => {
    await page();
    expect(await screen.findByRole('tab', { name: 'Riwayat' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Isi' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Simpan' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Unggah versi baru' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Salin hash revisi 3' })).toBeTruthy();
    // Biner tidak punya diff dan tidak dapat "dikembalikan" dari daftar.
    expect(screen.queryByRole('button', { name: 'Bandingkan' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Kembalikan revisi/ })).toBeNull();
  });
});

describe('FileEditorPage: berkas tak ada', () => {
  test('NOT_FOUND menampilkan pesan dan tombol kembali', async () => {
    apiMock.mockImplementation(async () => {
      throw new ApiError('NOT_FOUND', 'Berkas tidak ditemukan', '-');
    });
    await page();
    expect(await screen.findByText('Berkas tidak ditemukan')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar berkas' }));
    expect(onBack).toHaveBeenCalled();
  });
});
