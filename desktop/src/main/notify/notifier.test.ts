import { describe, expect, test } from 'vitest';
import type { StreamNotice } from './notice';
import { createNotifier, type NotifierDeps, type ShownNotice } from './notifier';

const NOTICE: StreamNotice = {
  id: 'n1',
  title: 'Judul',
  body: 'Isi',
  url: '/handover/h1',
  tag: 'h1',
  createdAt: '2026-11-16T03:00:00.000Z',
};

function setup(supported = true, initiallyFocused = false) {
  const state = { focused: initiallyFocused };
  const shown: ShownNotice[] = [];
  const calls: string[] = [];
  const deps: NotifierDeps = {
    supported: () => supported,
    isWindowFocused: () => state.focused,
    show: (notice) => shown.push(notice),
    focusWindow: () => calls.push('focus'),
    openPath: (path) => calls.push(`open:${path}`),
  };
  return { notifier: createNotifier(deps), shown, calls, state };
}

describe('createNotifier', () => {
  test('menampilkan judul dan isi; klik memfokuskan jendela lalu membuka jalur', () => {
    const { notifier, shown, calls } = setup();
    notifier.handle(NOTICE);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ title: 'Judul', body: 'Isi' });
    shown[0]?.onClick();
    expect(calls).toEqual(['focus', 'open:/handover/h1']);
  });

  test('id yang sama tidak ditampilkan dua kali (kiriman ulang saat sambung ulang)', () => {
    const { notifier, shown } = setup();
    notifier.handle(NOTICE);
    notifier.handle(NOTICE);
    notifier.handle({ ...NOTICE, id: 'n2' });
    expect(shown).toHaveLength(2);
  });

  test('penampil tak didukung: diam saja', () => {
    const { notifier, shown } = setup(false);
    notifier.handle(NOTICE);
    expect(shown).toEqual([]);
  });

  test('jendela terlihat dan fokus: popup OS dilewati (lonceng sudah berubah seketika)', () => {
    const { notifier, shown } = setup(true, true);
    notifier.handle(NOTICE);
    expect(shown).toEqual([]);
  });

  test('fokus berpindah: notifikasi baru kembali tampil, tetapi id yang sudah dilewati tidak muncul belakangan', () => {
    const { notifier, shown, state } = setup(true, true);
    notifier.handle(NOTICE); // dilewati karena fokus
    state.focused = false;
    notifier.handle(NOTICE); // kiriman ulang (sambung ulang): tidak boleh muncul sebagai popup basi
    expect(shown).toEqual([]);
    notifier.handle({ ...NOTICE, id: 'n2' });
    expect(shown).toHaveLength(1);
    state.focused = true;
    notifier.handle({ ...NOTICE, id: 'n3' });
    expect(shown).toHaveLength(1);
  });

  test('tautan tak aman jatuh ke beranda', () => {
    const { notifier, shown, calls } = setup();
    notifier.handle({ ...NOTICE, url: '//evil.com' });
    shown[0]?.onClick();
    expect(calls).toEqual(['focus', 'open:/']);
  });
});
