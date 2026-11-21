import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

import { renderInRouter } from '@/test/render-in-router';
import { HandoverCard } from './handover-card';
import { HandoverDetailView } from './handover-detail-view';
import { makeHandover } from './test-handover';

const noop = () => undefined;

async function renderCard(canOpenCustomer: boolean | undefined, handover = makeHandover()) {
  await renderInRouter(
    <HandoverCard
      handover={handover}
      canMarkDone
      canEdit
      canCancel
      pending={false}
      {...(canOpenCustomer === undefined ? {} : { canOpenCustomer })}
      onOpen={noop}
      onCheck={noop}
      onMarkDone={noop}
      onReopen={noop}
      onEdit={noop}
      onCancel={noop}
      onComment={noop}
    />,
  );
}

async function renderDetail(canOpenCustomer: boolean | undefined, handover = makeHandover()) {
  await renderInRouter(
    <HandoverDetailView
      handover={handover}
      locationName="Lokasi A"
      {...(canOpenCustomer === undefined ? {} : { canOpenCustomer })}
      canEdit
      canCancel
      canProgress
      pending={false}
      onBack={noop}
      onEdit={noop}
      onCancel={noop}
      onMarkDone={noop}
      onReopen={noop}
      onCheck={noop}
      onComment={noop}
    />,
  );
}

test('kartu: nama customer menaut ke View customer hanya bila boleh (item: view)', async () => {
  await renderCard(true);
  expect(screen.getByRole('link', { name: 'PT Maju' })).toHaveAttribute('href', '/customer/c1');
});

test('kartu: tanpa izin (bawaan) nama customer berupa teks biasa', async () => {
  await renderCard(undefined);
  expect(screen.queryByRole('link', { name: 'PT Maju' })).toBeNull();
  expect(screen.getByText('PT Maju')).toBeInTheDocument();
});

test('kartu tanpa customer: tetap "Tanpa customer" tanpa tautan', async () => {
  await renderCard(true, makeHandover({ customerId: '', customerName: '' }));
  expect(screen.getByText('Tanpa customer')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Tanpa customer/ })).toBeNull();
});

test('detail: nama customer menaut ke View customer hanya bila boleh', async () => {
  await renderDetail(true);
  expect(screen.getByRole('link', { name: 'PT Maju' })).toHaveAttribute('href', '/customer/c1');
});

test('detail: tanpa izin (bawaan) nama customer berupa teks biasa', async () => {
  await renderDetail(undefined);
  expect(screen.queryByRole('link', { name: 'PT Maju' })).toBeNull();
  expect(screen.getByText('PT Maju')).toBeInTheDocument();
});
