import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { PendingCreateCard } from './pending-create-card';

const task = {
  key: 'k',
  customerName: 'PT Maju',
  note: '- [ ] A = 1',
  status: 'waiting' as const,
};

test('menampilkan nomor "—", customer, dan label Belum terkirim; tidak dapat dibuka', () => {
  const { container } = render(<PendingCreateCard task={task} />);
  expect(screen.getByText('—')).toBeInTheDocument();
  expect(screen.getByText('PT Maju')).toBeInTheDocument();
  expect(screen.getByText('Belum terkirim')).toBeInTheDocument();
  const card = container.querySelector('[data-pending-create]');
  expect(card).toHaveAttribute('aria-disabled', 'true');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('status sending menampilkan Mengirim…', () => {
  render(<PendingCreateCard task={{ ...task, status: 'sending' }} />);
  expect(screen.getByText('Mengirim…')).toBeInTheDocument();
  expect(screen.queryByText('Belum terkirim')).not.toBeInTheDocument();
});
