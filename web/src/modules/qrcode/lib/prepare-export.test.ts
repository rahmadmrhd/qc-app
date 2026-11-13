import type { QrDesignDto } from '@shared/contract';
import type { QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, test, vi } from 'vitest';
import { isBusy, resetBusyForTests } from '@/app/pwa/busy';

const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('./export-files', () => ({
  renderExportFiles: (...args: unknown[]) => mocks.render(...args),
}));

import { prepareExportFiles } from './prepare-export';

beforeEach(() => {
  resetBusyForTests();
  mocks.render.mockReset();
});

const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const design = (logoFileId: string) => ({ id: 'd1', logoFileId }) as unknown as QrDesignDto;
const files = { pdf: new Uint8Array(1), png: new Uint8Array(1), preview: new Uint8Array(1) };

test('A6: sibuk selama logo dimuat DAN selama berkas dirender, padam setelah selesai', async () => {
  let finishLogo: (value: unknown) => void = () => undefined;
  let finishRender: (value: unknown) => void = () => undefined;
  const queryClient = {
    fetchQuery: vi.fn(() => new Promise((resolve) => (finishLogo = resolve))),
  } as unknown as QueryClient;
  mocks.render.mockReturnValue(new Promise((resolve) => (finishRender = resolve)));
  const steps: string[] = [];

  const pending = prepareExportFiles(queryClient, design('logo-1'), (step) => steps.push(step));
  expect(isBusy()).toBe(true);
  await flushMicrotasks();
  expect(isBusy()).toBe(true);
  finishLogo({ mime: 'image/png', bytes: new Uint8Array(1) });
  await flushMicrotasks();
  expect(mocks.render).toHaveBeenCalled();
  expect(isBusy()).toBe(true);
  finishRender(files);
  await expect(pending).resolves.toBe(files);
  expect(isBusy()).toBe(false);
  expect(steps).toEqual(['Memuat logo dari Drive…', 'Membuat PDF lembar 10 × 14 dan PNG label…']);
});

test('A6: tanpa logo tidak memuat logo; sibuk padam juga saat render gagal', async () => {
  const queryClient = { fetchQuery: vi.fn() } as unknown as QueryClient;
  mocks.render.mockRejectedValue(new Error('terlalu besar'));
  await expect(prepareExportFiles(queryClient, design(''), () => undefined)).rejects.toThrow(
    'terlalu besar',
  );
  expect(queryClient.fetchQuery).not.toHaveBeenCalled();
  expect(mocks.render).toHaveBeenCalledWith(expect.anything(), null);
  expect(isBusy()).toBe(false);
});
