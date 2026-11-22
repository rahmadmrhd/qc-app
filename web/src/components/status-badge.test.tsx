import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ActiveStatusBadge } from './status-badge';

it('aktif bertanda success, selain itu secondary, label bisa ditimpa', () => {
  const { rerender } = render(<ActiveStatusBadge status="active" />);
  expect(screen.getByText('Aktif').className).toContain('success');
  rerender(<ActiveStatusBadge status="inactive" />);
  expect(screen.getByText('Nonaktif').className).not.toContain('success');
  rerender(<ActiveStatusBadge status="deprecated" label="Usang" />);
  expect(screen.getByText('Usang')).toBeInTheDocument();
});
