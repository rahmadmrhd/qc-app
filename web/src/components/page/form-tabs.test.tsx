import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { type FormTab, FormTabs, firstTabWithError } from './form-tabs';

const TABS: FormTab[] = [
  { id: 'detail', label: 'Detail', content: <input aria-label="Nama" /> },
  { id: 'gambar', label: 'Gambar', content: <input aria-label="Gambar wajib" />, hasError: true },
];

test('tab dengan galat bertitik merah dan firstTabWithError menunjuknya', () => {
  const { container } = render(<FormTabs tabs={TABS} />);
  expect(firstTabWithError(TABS)).toBe('gambar');
  expect(firstTabWithError([TABS[0] as FormTab])).toBeUndefined();
  const trigger = screen.getByRole('tab', { name: /Gambar/ });
  expect(trigger.querySelector('[data-slot="tab-error-dot"]')).not.toBeNull();
  expect(trigger).toHaveAttribute('aria-describedby');
  expect(container.querySelectorAll('[data-slot="tab-error-dot"]')).toHaveLength(1);
});

test('isi tab tak aktif tetap ada di DOM tetapi hidden', () => {
  render(<FormTabs tabs={TABS} />);
  const hidden = screen.getByLabelText('Gambar wajib', { selector: 'input' });
  expect(hidden.closest('[role="tabpanel"]')).toHaveAttribute('hidden');
  expect(screen.getByLabelText('Nama').closest('[role="tabpanel"]')).not.toHaveAttribute('hidden');
});

test('klik tab menampilkan panelnya; value terkendali diikuti', async () => {
  const { rerender } = render(<FormTabs tabs={TABS} />);
  await userEvent.click(screen.getByRole('tab', { name: /Gambar/ }));
  expect(screen.getByLabelText('Gambar wajib').closest('[role="tabpanel"]')).not.toHaveAttribute(
    'hidden',
  );
  rerender(<FormTabs tabs={TABS} value="detail" />);
  expect(screen.getByLabelText('Nama').closest('[role="tabpanel"]')).not.toHaveAttribute('hidden');
});

test('daftar tab sticky dengan stickyTop; pemicu dan panel membawa data-form-tab', () => {
  const { container } = render(<FormTabs tabs={TABS} stickyTop="0px" />);
  const list = screen.getByRole('tablist');
  expect(list.className).toContain('sticky');
  expect(list.style.top).toBe('0px');
  expect(container.querySelectorAll('[data-form-tab="gambar"]')).toHaveLength(2);
});

test('stickyTop bawaan memakai offset headroom', () => {
  render(<FormTabs tabs={TABS} />);
  expect(screen.getByRole('tablist').style.top).toBe('var(--headroom-offset,3.5rem)');
});
