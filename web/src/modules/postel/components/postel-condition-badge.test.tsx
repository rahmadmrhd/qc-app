import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { PostelConditionBadge } from './postel-condition-badge';

test.each([
  ['valid', 'Berlaku'],
  ['soon', 'Segera habis'],
  ['expired', 'Kedaluwarsa'],
] as const)('kondisi %s tampil sebagai %s', (condition, label) => {
  render(<PostelConditionBadge condition={condition} />);
  expect(screen.getByText(label)).toBeInTheDocument();
});
