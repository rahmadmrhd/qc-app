import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { isBusy, resetBusyForTests } from '@/app/pwa/busy';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), mutateAsync: vi.fn() }));
vi.mock('@/modules/files/image', () => ({
  prepareImage: (...args: unknown[]) => mocks.prepare(...args),
}));
vi.mock('@/modules/files/queries', () => ({
  useUploadFile: () => ({ mutateAsync: mocks.mutateAsync }),
  useFileUrl: () => ({ url: null, isLoading: false }),
}));

import { LogoLibraryField } from './logo-library-field';

beforeEach(() => {
  resetBusyForTests();
  mocks.prepare.mockReset();
  mocks.mutateAsync.mockReset();
});

test('I2: menambah logo menandai registri sibuk sejak pengecilan sampai unggah selesai', async () => {
  let finish: (value: unknown) => void = () => undefined;
  mocks.prepare.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  mocks.mutateAsync.mockResolvedValue({ id: 'logo1' });
  const onLibraryChange = vi.fn();
  render(<LogoLibraryField library={[]} onLibraryChange={onLibraryChange} />);
  await userEvent.upload(
    screen.getByLabelText('Tambah logo ke pustaka'),
    new File([new Uint8Array(4)], 'l.png', { type: 'image/png' }),
  );
  expect(isBusy()).toBe(true);
  finish({ mime: 'image/png', bytes: new Uint8Array(1) });
  await waitFor(() => expect(onLibraryChange).toHaveBeenCalledWith(['logo1']));
  expect(isBusy()).toBe(false);
});
