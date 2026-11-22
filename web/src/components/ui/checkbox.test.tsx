import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Checkbox } from './checkbox';

/** Ikon di dalam indikator: tanda minus hanya untuk `indeterminate`, tanda centang selainnya (jsdom tak menata letak). */
function icons() {
  const indicator = document.querySelector('[data-slot="checkbox-indicator"]') as HTMLElement;
  return {
    indicator,
    check: indicator.querySelector('svg:not([data-slot="checkbox-minus"])') as SVGElement,
    minus: indicator.querySelector('[data-slot="checkbox-minus"]') as SVGElement,
  };
}

test('indeterminate: isi kotak (border/latar primary) dan tanda minus; tanda centang disembunyikan', () => {
  render(<Checkbox aria-label="semua" checked="indeterminate" />);
  const box = screen.getByRole('checkbox', { name: 'semua' });
  expect(box).toHaveAttribute('aria-checked', 'mixed');
  expect(box).toHaveAttribute('data-state', 'indeterminate');
  expect(box.className).toContain('data-[state=indeterminate]:bg-primary');
  expect(box.className).toContain('data-[state=indeterminate]:border-primary');
  expect(box.className).toContain('data-[state=indeterminate]:text-primary-foreground');
  const { minus, check } = icons();
  expect(minus).not.toBeNull();
  expect(minus.getAttribute('class')).toContain('group-data-[state=indeterminate]/checkbox:block');
  expect(check.getAttribute('class')).toContain('group-data-[state=indeterminate]/checkbox:hidden');
});

test('checked biasa: indikator memuat tanda centang yang tampil (tanda minus tersembunyi)', () => {
  render(<Checkbox aria-label="satu" checked />);
  expect(screen.getByRole('checkbox', { name: 'satu' })).toHaveAttribute('aria-checked', 'true');
  const { minus, check } = icons();
  expect(check.getAttribute('class')).not.toContain('block');
  expect(minus.getAttribute('class')).toContain('hidden');
});

test('tidak tercentang: tanpa indikator', () => {
  render(<Checkbox aria-label="kosong" checked={false} />);
  expect(document.querySelector('[data-slot="checkbox-indicator"]')).toBeNull();
});
