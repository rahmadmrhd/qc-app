import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert } from './alert';

describe('Alert', () => {
  it('berwarna: role alert, data-color, ikon aria-hidden', () => {
    render(<Alert color="warning">Hati-hati</Alert>);
    const a = screen.getByRole('alert');
    expect(a).toHaveAttribute('data-color', 'warning');
    expect(a.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('varian lama destructive dipetakan ke color destructive', () => {
    render(<Alert variant="destructive">x</Alert>);
    expect(screen.getByRole('alert')).toHaveAttribute('data-color', 'destructive');
  });

  it('netral tanpa ikon sisipan', () => {
    render(<Alert>x</Alert>);
    expect(screen.getByRole('alert').querySelector('svg')).toBeNull();
  });
});
