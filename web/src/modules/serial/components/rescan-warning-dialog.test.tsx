import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { RescanWarning } from '../lib/rescan';
import { RescanWarningDialog } from './rescan-warning-dialog';

const warn = (n: number): RescanWarning => ({
  clientId: `c${n}`,
  serial: `SN${n}`,
  actorName: 'Budi',
  at: '2026-11-25T03:00:00.000Z',
});

test('menampilkan jumlah, pelaku, dan memotong daftar di 20', async () => {
  const onContinue = vi.fn();
  const onCancel = vi.fn();
  const warnings = Array.from({ length: 23 }, (_, i) => warn(i + 1));
  render(
    <RescanWarningDialog open warnings={warnings} onContinue={onContinue} onCancel={onCancel} />,
  );
  expect(screen.getByText(/23 serial ini sudah dicatat/)).toBeInTheDocument();
  expect(screen.getByText('SN20')).toBeInTheDocument();
  expect(screen.queryByText('SN21')).toBeNull();
  expect(screen.getByText('dan 3 lainnya')).toBeInTheDocument();
  expect(screen.getAllByText(/oleh Budi, /)).toHaveLength(20);
  await userEvent.click(screen.getByRole('button', { name: 'Lanjut menyimpan' }));
  expect(onContinue).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalled();
});
