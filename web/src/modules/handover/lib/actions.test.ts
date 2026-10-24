import { expect, test } from 'vitest';
import { handoverActions } from './actions';

const all = { canMarkDone: true, canEdit: true, canManage: true };

test('Mark done hanya Baru dan Dikerjakan; Selesai tanpa Mark done dan tanpa Buka kembali', () => {
  expect(handoverActions('new', all).markDone).toBe(true);
  expect(handoverActions('in_progress', all).markDone).toBe(true);
  const done = handoverActions('done', all);
  expect(done.markDone).toBe(false);
  expect(done.reopen).toBe(false);
});

test('Buka kembali hanya Dibatalkan dan hanya dengan handover:manage', () => {
  expect(handoverActions('cancelled', all)).toMatchObject({
    reopen: true,
    markDone: false,
    edit: false,
    cancel: false,
    more: false,
  });
  expect(handoverActions('cancelled', { ...all, canManage: false }).reopen).toBe(false);
  expect(handoverActions('new', all).reopen).toBe(false);
});

test('More: Ubah (bukan Dibatalkan) dan Batalkan (bukan Selesai/Dibatalkan); tanpa aksi tidak ada More', () => {
  expect(handoverActions('in_progress', all)).toMatchObject({
    edit: true,
    cancel: true,
    more: true,
  });
  expect(handoverActions('done', all)).toMatchObject({ edit: true, cancel: false, more: true });
  expect(handoverActions('new', { ...all, canEdit: false, canManage: false }).more).toBe(false);
  expect(handoverActions('done', { ...all, canEdit: false }).more).toBe(false);
});

test('Mark done tampil tetapi nonaktif tanpa qc:edit', () => {
  const none = handoverActions('new', { ...all, canMarkDone: false });
  expect(none.markDone).toBe(true);
  expect(none.markDoneEnabled).toBe(false);
});
