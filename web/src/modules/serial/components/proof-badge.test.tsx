import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ProofBadge, ProofProblemBadge } from './proof-badge';

test('badge menuliskan Bukti foto QC', () => {
  render(<ProofBadge />);
  expect(screen.getByText('Bukti foto QC')).toBeInTheDocument();
});

test('badge Foto bermasalah tampil bila jumlah > 0 dan memuat jumlahnya untuk pembaca layar', () => {
  render(<ProofProblemBadge count={2} />);
  expect(screen.getByText('Foto bermasalah')).toBeInTheDocument();
  expect(screen.getByText('(2)')).toBeInTheDocument();
});

test('badge Foto bermasalah tidak tampil bila jumlah 0', () => {
  const { container } = render(<ProofProblemBadge count={0} />);
  expect(container).toBeEmptyDOMElement();
});
