import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { QueuedFile } from '@/components/file-dialog';

const apiMock = vi.hoisted(() => vi.fn());
const prepareImageMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('@/modules/files/image', () => ({ prepareImage: prepareImageMock }));

import { resetBusyForTests } from '@/app/pwa/busy';
import { useProofUploads } from './use-proof-uploads';

let counter = 0;
const queued = (name: string): QueuedFile => ({
  key: name,
  file: new File([new Uint8Array(4)], name, { type: 'image/jpeg' }),
  name,
});

function deferUploads() {
  const release: Array<() => void> = [];
  apiMock.mockImplementation(
    (id: string) =>
      new Promise((resolve) => {
        if (id !== 'serialProofs.upload') return resolve({ id: 'x' });
        release.push(() => {
          counter += 1;
          resolve({
            id: `p${counter}`,
            state: 'draft',
            mime: 'image/webp',
            size: 100,
            width: 10,
            height: 10,
            filename: `bukti-p${counter}.webp`,
            error: null,
          });
        });
      }),
  );
  return release;
}

beforeEach(() => {
  apiMock.mockReset();
  prepareImageMock.mockReset();
  prepareImageMock.mockResolvedValue({
    mime: 'image/webp',
    bytes: new Uint8Array(3),
    width: 10,
    height: 10,
  });
  counter = 0;
  resetBusyForTests();
});

test('hasil sukses diubah menjadi ProofPhotoRef dan diserahkan ke onAdd bersama pemiliknya', async () => {
  const release = deferUploads();
  const onAdd = vi.fn(() => true);
  const { result } = renderHook(() => useProofUploads({ onAdd }));
  act(() => result.current.forOwner('row-1').add([queued('a.jpg')]));
  await waitFor(() => expect(release).toHaveLength(1));
  expect(result.current.busy).toBe(true);
  act(() => release[0]?.());
  await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
  expect(onAdd).toHaveBeenCalledWith('row-1', {
    id: 'p1',
    mime: 'image/webp',
    size: 100,
    thumbUrl: '/api/v1/serial-proofs/p1',
  });
  await waitFor(() => expect(result.current.entries).toHaveLength(0));
});

test('onAdd false (baris penuh/hilang): foto dibuang di server lewat serialProofs.remove dan entri hilang', async () => {
  const release = deferUploads();
  const { result } = renderHook(() => useProofUploads({ onAdd: () => false }));
  act(() => result.current.forOwner('row-1').add([queued('a.jpg')]));
  await waitFor(() => expect(release).toHaveLength(1));
  act(() => release[0]?.());
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('serialProofs.remove', { id: 'p1' }));
  await waitFor(() => expect(result.current.entries).toHaveLength(0));
});

test('cancelOwner membatalkan unggahan pemiliknya; hasil yang tiba sesudahnya dibuang, pemilik lain tak terganggu', async () => {
  const release = deferUploads();
  const onAdd = vi.fn(() => true);
  const { result } = renderHook(() => useProofUploads({ onAdd }));
  act(() => {
    result.current.forOwner('row-1').add([queued('a.jpg')]);
    result.current.forOwner('row-2').add([queued('b.jpg')]);
  });
  await waitFor(() => expect(release).toHaveLength(2));
  act(() => result.current.cancelOwner('row-1'));
  expect(result.current.entries.map((entry) => entry.owner)).toEqual(['row-2']);
  act(() => {
    release[0]?.();
    release[1]?.();
  });
  await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
  expect(onAdd).toHaveBeenCalledWith('row-2', expect.objectContaining({ id: 'p2' }));
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('serialProofs.remove', { id: 'p1' }));
});

test('gagal mengunggah: entri failed menahan (hasFailed) sampai diulang atau dibuang', async () => {
  apiMock.mockRejectedValue(new Error('Server menolak'));
  const { result } = renderHook(() => useProofUploads({ onAdd: () => true }));
  act(() => result.current.forOwner('row-1').add([queued('a.jpg')]));
  await waitFor(() => expect(result.current.hasFailed).toBe(true));
  expect(result.current.busy).toBe(false);
  const key = result.current.entries[0]?.key ?? '';
  act(() => result.current.forOwner('row-1').remove(key));
  expect(result.current.hasFailed).toBe(false);
});
