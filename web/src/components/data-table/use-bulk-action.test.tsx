import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { BulkBar } from './bulk-bar';
import { useBulkAction } from './use-bulk-action';
import { useRowSelection } from './use-row-selection';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

function Harness({
  send,
  onResults,
  reload,
}: {
  send: (ids: string[]) => Promise<{ id: string }[]>;
  onResults?: (r: readonly { id: string }[]) => void;
  reload?: () => void;
}) {
  const selection = useRowSelection('x');
  const { run, busy } = useBulkAction({
    selection,
    send,
    verb: 'dinonaktifkan',
    onResults,
    reload,
  });
  return (
    <>
      <button type="button" onClick={() => selection.setAll(['a', 'b'], true)}>
        pilih
      </button>
      <BulkBar count={selection.count} onClear={selection.clear} busy={busy}>
        <button type="button" onClick={run}>
          Nonaktifkan
        </button>
      </BulkBar>
    </>
  );
}

test('sukses: hasil dipasang, pilihan dikosongkan, toast sukses, tanpa muat ulang', async () => {
  const send = vi.fn(async (ids: string[]) => ids.map((id) => ({ id })));
  const onResults = vi.fn();
  const reload = vi.fn();
  render(<Harness send={send} onResults={onResults} reload={reload} />);
  await userEvent.click(screen.getByText('pilih'));
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan' }));
  expect(onResults).toHaveBeenCalledWith([{ id: 'a' }, { id: 'b' }]);
  expect(toast.success).toHaveBeenCalledWith('2 item dinonaktifkan');
  expect(reload).not.toHaveBeenCalled();
  expect(screen.queryByText(/dipilih/)).toBeNull();
});

test('gagal: toast galat, pilihan tetap, muat ulang dipanggil', async () => {
  const send = vi.fn(async () => {
    throw new ApiError('NOT_FOUND', 'Ada yang dihapus', 'req-1');
  });
  const reload = vi.fn();
  render(<Harness send={send} reload={reload} />);
  await userEvent.click(screen.getByText('pilih'));
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan' }));
  expect(toast.error).toHaveBeenCalled();
  expect(reload).toHaveBeenCalledTimes(1);
  expect(screen.getByText('2 dipilih')).toBeInTheDocument();
});

test('busy menonaktifkan tombol dan klik ganda hanya mengirim sekali', async () => {
  let release: () => void = () => undefined;
  const send = vi.fn(
    (ids: string[]) =>
      new Promise<{ id: string }[]>((resolve) => {
        release = () => resolve(ids.map((id) => ({ id })));
      }),
  );
  render(<Harness send={send} />);
  await userEvent.click(screen.getByText('pilih'));
  const button = screen.getByRole('button', { name: 'Nonaktifkan' });
  await userEvent.click(button);
  expect(button).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Batalkan pilihan' })).toBeDisabled();
  await userEvent.click(button);
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => release());
  expect(screen.queryByText(/dipilih/)).toBeNull();
});
