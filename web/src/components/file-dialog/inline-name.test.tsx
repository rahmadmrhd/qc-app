import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { hasUnsavedChanges, resetUnsavedChangesForTests } from '@/app/pwa/unsaved-changes';
import { InlineName } from './inline-name';

beforeEach(() => {
  resetUnsavedChangesForTests();
});

test('nama yang sedang diubah dan berbeda terdaftar belum disimpan; selesai atau batal melepas', async () => {
  const onSave = vi.fn();
  render(<InlineName value="Logo A" onSave={onSave} />);
  expect(hasUnsavedChanges()).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Ubah nama Logo A' }));
  expect(hasUnsavedChanges()).toBe(false);
  await userEvent.type(screen.getByLabelText('Nama'), ' baru');
  expect(hasUnsavedChanges()).toBe(true);
  await userEvent.keyboard('{Enter}');
  expect(onSave).toHaveBeenCalledWith('Logo A baru');
  expect(hasUnsavedChanges()).toBe(false);
});

test('Esc membatalkan dan melepas pendaftaran', async () => {
  render(<InlineName value="Logo A" onSave={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Ubah nama Logo A' }));
  await userEvent.type(screen.getByLabelText('Nama'), 'x');
  expect(hasUnsavedChanges()).toBe(true);
  await userEvent.keyboard('{Escape}');
  expect(hasUnsavedChanges()).toBe(false);
});
