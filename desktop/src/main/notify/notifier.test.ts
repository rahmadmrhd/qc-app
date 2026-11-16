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

function setup(supported = true) {
  const shown: ShownNotice[] = [];
  const calls: string[] = [];
  const deps: NotifierDeps = {
    supported: () => supported,
    show: (notice) => shown.push(notice),
    focusWindow: () => calls.push('focus'),
    openPath: (path) => calls.push(`open:${path}`),
  };
  return { notifier: createNotifier(deps), shown, calls };
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

  test('tautan tak aman jatuh ke beranda', () => {
    const { notifier, shown, calls } = setup();
    notifier.handle({ ...NOTICE, url: '//evil.com' });
    shown[0]?.onClick();
    expect(calls).toEqual(['focus', 'open:/']);
  });
});
