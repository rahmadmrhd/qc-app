import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { hasUnsavedChanges, resetUnsavedChangesForTests } from '@/app/pwa/unsaved-changes';
import { CommentComposer } from './comment-composer';

beforeEach(() => {
  resetUnsavedChangesForTests();
});

test('draf komentar terdaftar sebagai belum disimpan; kosong atau dilepas tidak', async () => {
  const view = render(<CommentComposer quote="x" onSubmit={vi.fn()} onCancel={() => undefined} />);
  expect(hasUnsavedChanges()).toBe(false);
  await userEvent.type(screen.getByRole('textbox', { name: 'Komentar' }), 'draf');
  expect(hasUnsavedChanges()).toBe(true);
  await userEvent.clear(screen.getByRole('textbox', { name: 'Komentar' }));
  expect(hasUnsavedChanges()).toBe(false);
  await userEvent.type(screen.getByRole('textbox', { name: 'Komentar' }), 'lagi');
  view.unmount();
  expect(hasUnsavedChanges()).toBe(false);
});

test('menampilkan kutipan, mengirim isi, dan menutup setelah berhasil', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<CommentComposer quote="kirim sore" onSubmit={onSubmit} onCancel={() => undefined} />);
  expect(screen.getByText('kirim sore')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kirim' })).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox', { name: 'Komentar' }), 'Mohon cek');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Mohon cek'));
});

test('galat pengiriman ditampilkan dan isi dipertahankan', async () => {
  const onSubmit = vi.fn().mockRejectedValue(new Error('Kutipan tidak ditemukan pada catatan'));
  render(<CommentComposer quote="x" onSubmit={onSubmit} onCancel={() => undefined} />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Komentar' }), 'isi');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Kutipan tidak ditemukan');
  expect(screen.getByRole('textbox', { name: 'Komentar' })).toHaveValue('isi');
});

test('Batal memanggil onCancel; batas 1000 karakter', async () => {
  const onCancel = vi.fn();
  render(<CommentComposer quote="x" onSubmit={vi.fn()} onCancel={onCancel} />);
  expect(screen.getByRole('textbox', { name: 'Komentar' })).toHaveAttribute('maxlength', '1000');
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalled();
});
