import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ProofBadge } from './proof-badge';

test('badge menuliskan Bukti foto QC', () => {
  render(<ProofBadge />);
  expect(screen.getByText('Bukti foto QC')).toBeInTheDocument();
});
