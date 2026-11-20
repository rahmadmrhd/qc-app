import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { StampPreviewInput } from '../lib/stamp-preview';
import { proofCameraStamp } from './stamp-preview';

const INPUT: StampPreviewInput = {
  serial: 'ABC123',
  itemLabel: 'Cisco C9200',
  buLabel: 'BU1',
  locationLabel: 'Surabaya',
  actorName: 'Budi',
  actorTeam: 'QC',
};

test('proofCameraStamp: renderNote menampilkan empat baris cap dan keterangan server', () => {
  render(<>{proofCameraStamp(INPUT).renderNote()}</>);
  const note = screen.getByRole('note', { name: 'Pratinjau cap' });
  expect(note).toHaveTextContent('SN: ABC123');
  expect(note).toHaveTextContent('Cisco C9200');
  expect(note).toHaveTextContent('BU1 · Surabaya');
  expect(note).toHaveTextContent('Disimpan saat Simpan · Budi (QC)');
  expect(note).toHaveTextContent('cap resmi ditambahkan server saat Simpan');
});

test('proofCameraStamp: renderToggle berlabel sesuai keadaan dan memanggil onToggle', async () => {
  const onToggle = vi.fn();
  const slot = proofCameraStamp(INPUT);
  const { rerender } = render(<>{slot.renderToggle(true, onToggle)}</>);
  await userEvent.click(screen.getByRole('button', { name: 'Sembunyikan pratinjau cap' }));
  expect(onToggle).toHaveBeenCalledTimes(1);
  rerender(<>{slot.renderToggle(false, onToggle)}</>);
  expect(screen.getByRole('button', { name: 'Tampilkan pratinjau cap' })).toBeInTheDocument();
});
