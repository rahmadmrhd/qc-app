import { renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { isBusy, resetBusyForTests } from '@/app/pwa/busy';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), mutateAsync: vi.fn() }));
vi.mock('./image', () => ({ prepareImage: (...args: unknown[]) => mocks.prepare(...args) }));
vi.mock('./queries', () => ({ useUploadFile: () => ({ mutateAsync: mocks.mutateAsync }) }));

import { useUploadImage } from './use-upload-image';

beforeEach(() => {
  resetBusyForTests();
  mocks.prepare.mockReset();
  mocks.mutateAsync.mockReset();
});

const file = new File([new Uint8Array(4)], 'a.png', { type: 'image/png' });

const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

test('I2: sibuk selama pengecilan DAN selama unggah menggantung, padam setelah selesai', async () => {
  let finish: (value: unknown) => void = () => undefined;
  let finishUpload: (value: unknown) => void = () => undefined;
  mocks.prepare.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  mocks.mutateAsync.mockReturnValue(new Promise((resolve) => (finishUpload = resolve)));
  const upload = renderHook(() => useUploadImage()).result.current;
  const pending = upload(file);
  expect(isBusy()).toBe(true);
  await flushMicrotasks();
  expect(isBusy()).toBe(true);
  finish({ mime: 'image/png', bytes: new Uint8Array(1) });
  await flushMicrotasks();
  expect(mocks.mutateAsync).toHaveBeenCalled();
  expect(isBusy()).toBe(true);
  finishUpload({ id: 'f1' });
  await expect(pending).resolves.toBe('f1');
  expect(isBusy()).toBe(false);
});

test('I2: registri sibuk padam juga saat pengecilan gagal', async () => {
  mocks.prepare.mockRejectedValue(new Error('rusak'));
  const upload = renderHook(() => useUploadImage()).result.current;
  await expect(upload(file)).rejects.toThrow('rusak');
  expect(isBusy()).toBe(false);
});
