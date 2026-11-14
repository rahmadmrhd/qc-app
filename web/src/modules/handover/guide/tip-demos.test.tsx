import { HANDOVER_LIMITS } from '@shared/handover';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { hasUnsavedChanges } from '@/app/pwa/unsaved-changes';
import type { DemoScene } from '@/modules/guide/lib/demo-types';
import { ChecklistDemoScenes } from './checklist-demo';
import { CommentDemoScenes } from './comment-demo';
import { DEMO_COMMENT_BODY, DEMO_ITEMS } from './demo-card';

// Demo tanpa efek samping: api() tidak boleh dipanggil, dan tak ada kueri (tes ini merender TANPA QueryClientProvider).
const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: (...args: unknown[]) => apiMock(...args),
}));

function sceneAt(scenes: readonly DemoScene[], index: number) {
  const scene = scenes[index];
  if (scene?.kind !== 'kode') throw new Error(`adegan ${index} bukan adegan kode`);
  return scene;
}

const ATTEMPT = (scenes: readonly DemoScene[], index: number) =>
  render(sceneAt(scenes, index).render());

let setItem: ReturnType<typeof vi.spyOn>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiMock.mockReset();
  setItem = vi.spyOn(Storage.prototype, 'setItem');
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('demo tip-handover-checklist', () => {
  test('tiga bingkai berurutan dengan keterangan santai', () => {
    expect(ChecklistDemoScenes).toHaveLength(3);
    expect(ChecklistDemoScenes.every((scene) => scene.kind === 'kode')).toBe(true);
    expect(ChecklistDemoScenes.map((scene) => scene.caption)).toEqual([
      expect.stringContaining('checklist'),
      expect.stringContaining('mencentang'),
      expect.stringContaining('Selesai'),
    ]);
  });

  test('(a) kartu dengan checklist, status Baru, 0/3, dan lencana Contoh', () => {
    const { container } = ATTEMPT(ChecklistDemoScenes, 0);
    expect(screen.getByText('Contoh')).toBeInTheDocument();
    expect(screen.getByText('Baru')).toBeInTheDocument();
    expect(screen.getByText('0/3')).toBeInTheDocument();
    for (const item of DEMO_ITEMS) expect(screen.getByText(item)).toBeInTheDocument();
    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(0);
  });

  test('(b) satu butir tercentang: nama dan waktu pencentang tampil seperti aslinya, status Dikerjakan', () => {
    const { container } = ATTEMPT(ChecklistDemoScenes, 1);
    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(1);
    expect(screen.getByText(/^oleh Rina QC · /)).toBeInTheDocument();
    expect(screen.getByText('Dikerjakan')).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  test('(c) semua tercentang: status Selesai', () => {
    const { container } = ATTEMPT(ChecklistDemoScenes, 2);
    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(3);
    expect(screen.getAllByText(/^oleh Rina QC · /)).toHaveLength(3);
    expect(screen.getByText('Selesai')).toBeInTheDocument();
    expect(screen.getByText('3/3')).toBeInTheDocument();
  });

  test('kartu contoh tak menjadi target tur dan tak dapat dioperasikan (inert)', () => {
    const { container } = ATTEMPT(ChecklistDemoScenes, 1);
    expect(container.querySelector('[data-tour]')).toBeNull();
    expect(container.querySelector('[inert]')).not.toBeNull();
  });
});

describe('demo tip-handover-komentar', () => {
  test('tiga bingkai berurutan: pilih teks, komposer, komentar tampil', () => {
    expect(CommentDemoScenes).toHaveLength(3);
    expect(CommentDemoScenes.every((scene) => scene.kind === 'kode')).toBe(true);
    expect(CommentDemoScenes.map((scene) => scene.caption)).toEqual([
      expect.stringContaining('Pilih sepotong teks'),
      expect.stringContaining('Kirim'),
      expect.stringContaining('Komentar tampil'),
    ]);
  });

  test('(a) teks butir pertama terseleksi (seleksi asli peramban)', async () => {
    ATTEMPT(CommentDemoScenes, 0);
    await waitFor(() => expect(window.getSelection()?.toString()).toBe(DEMO_ITEMS[0]));
  });

  test('(a) tombol pada kartu tak berfungsi: tak membuka komposer dan tak memasang status belum disimpan', async () => {
    const { container } = ATTEMPT(CommentDemoScenes, 0);
    await waitFor(() => expect(window.getSelection()?.toString()).toBe(DEMO_ITEMS[0]));
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      fireEvent.click(button);
      fireEvent.keyDown(button, { key: 'Enter' });
    }
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(hasUnsavedChanges()).toBe(false);
  });

  test('seleksi dilepas saat bingkai ditutup', async () => {
    const { unmount } = ATTEMPT(CommentDemoScenes, 0);
    await waitFor(() => expect(window.getSelection()?.toString()).toBe(DEMO_ITEMS[0]));
    unmount();
    expect(window.getSelection()?.toString()).toBe('');
  });

  test('(b) komposer: kutipan, kolom komentar berbatas karakter asli, Batal dan Kirim', () => {
    const { container } = ATTEMPT(CommentDemoScenes, 1);
    expect(screen.getByRole('textbox', { name: 'Komentar' })).toHaveValue(DEMO_COMMENT_BODY);
    expect(screen.getByRole('textbox', { name: 'Komentar' })).toHaveAttribute(
      'maxlength',
      String(HANDOVER_LIMITS.comment),
    );
    expect(container.querySelector('blockquote')?.textContent).toBe(DEMO_ITEMS[0]);
    expect(screen.getByText('Batal')).toBeInTheDocument();
    expect(screen.getByText('Kirim')).toBeInTheDocument();
  });

  test('(c) komentar tampil di bawah catatan dengan kutipan, penulis, dan penghitung', () => {
    const { container } = ATTEMPT(CommentDemoScenes, 2);
    const list = screen.getByRole('list', { name: 'Komentar' });
    expect(list.textContent).toContain(DEMO_COMMENT_BODY);
    expect(list.querySelector('blockquote')?.textContent).toBe(DEMO_ITEMS[0]);
    expect(list.textContent).toContain('Rina QC');
    expect(screen.getByText('1 komentar')).toBeInTheDocument();
    expect(container.querySelector('[data-tour]')).toBeNull();
  });
});

describe('tanpa efek samping', () => {
  test('semua bingkai kedua demo: tanpa api(), fetch, atau tulis storage, dan tanpa QueryClientProvider', async () => {
    for (const scenes of [ChecklistDemoScenes, CommentDemoScenes]) {
      for (let index = 0; index < scenes.length; index++) {
        const { unmount } = ATTEMPT(scenes, index);
        await Promise.resolve();
        unmount();
      }
    }
    expect(apiMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});
