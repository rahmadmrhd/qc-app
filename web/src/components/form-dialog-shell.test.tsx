import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { FormDialogShell } from './form-dialog-shell';
import { FormPage } from './page/form-page';
import { FormTabs } from './page/form-tabs';
import { TooltipProvider } from './ui/tooltip';

function Host({
  onPageSubmit,
  onDialogSubmit,
}: {
  onPageSubmit: () => void;
  onDialogSubmit: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <TooltipProvider>
      <FormPage formId="page-form" title="Halaman" onCancel={() => undefined}>
        <form
          id="page-form"
          onSubmit={(event) => {
            event.preventDefault();
            onPageSubmit();
          }}
        />
      </FormPage>
      <FormDialogShell open={open} onOpenChange={setOpen} formId="dialog-form" title="Tambah merk">
        <form
          id="dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            onDialogSubmit();
          }}
        >
          <input aria-label="Nama merk" />
        </form>
      </FormDialogShell>
    </TooltipProvider>
  );
}

test('Simpan dialog hanya men-submit form dialog, bukan form halaman di belakangnya', async () => {
  const onPageSubmit = vi.fn();
  const onDialogSubmit = vi.fn();
  render(<Host onPageSubmit={onPageSubmit} onDialogSubmit={onDialogSubmit} />);
  const dialog = await screen.findByRole('alertdialog', { name: 'Tambah merk' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onDialogSubmit).toHaveBeenCalledTimes(1);
  expect(onPageSubmit).not.toHaveBeenCalled();
});

test('Batal menutup dialog; submitting menonaktifkan Simpan', async () => {
  const { rerender } = render(
    <FormDialogShell open onOpenChange={() => undefined} formId="x" title="Judul" submitting>
      <form id="x" />
    </FormDialogShell>,
  );
  const dialog = await screen.findByRole('alertdialog', { name: 'Judul' });
  expect(within(dialog).getByRole('button', { name: 'Menyimpan…' })).toBeDisabled();
  rerender(
    <FormDialogShell open onOpenChange={() => undefined} formId="x" title="Judul">
      <form id="x" />
    </FormDialogShell>,
  );
  expect(within(dialog).getByRole('button', { name: 'Simpan' })).toBeEnabled();
});

test('Batal memanggil onOpenChange(false)', async () => {
  const onOpenChange = vi.fn();
  render(
    <FormDialogShell open onOpenChange={onOpenChange} formId="x" title="Judul">
      <form id="x" />
    </FormDialogShell>,
  );
  const dialog = await screen.findByRole('alertdialog', { name: 'Judul' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test('FormTabs di dalam dialog menempel tepat di bawah header dialog (offset diukur, bukan 0)', async () => {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.slot === 'dialog-header' ? 72 : 0;
    },
  });
  try {
    render(
      <FormDialogShell open onOpenChange={() => undefined} formId="x" title="Judul">
        <form id="x">
          <FormTabs
            tabs={[
              { id: 'detail', label: 'Detail', content: <p>a</p> },
              { id: 'gambar', label: 'Gambar', content: <p>b</p> },
            ]}
          />
        </form>
      </FormDialogShell>,
    );
    const list = await screen.findByRole('tablist');
    const dialog = await screen.findByRole('alertdialog', { name: 'Judul' });
    expect(list.className).toContain('sticky');
    expect(list.style.top).toContain('--dialog-header-height');
    expect(dialog.style.getPropertyValue('--dialog-header-height')).toBe('72px');
    expect(screen.getByRole('tab', { name: 'Gambar' })).toHaveAttribute('data-form-tab', 'gambar');
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original);
  }
});

function Stacked() {
  const [first, setFirst] = useState(true);
  const [second, setSecond] = useState(false);
  return (
    <>
      <FormDialogShell open={first} onOpenChange={setFirst} formId="a" title="Dialog bawah">
        <form id="a">
          <button type="button" onClick={() => setSecond(true)}>
            Tambah merk
          </button>
        </form>
      </FormDialogShell>
      <FormDialogShell open={second} onOpenChange={setSecond} formId="b" title="Dialog atas">
        <form id="b" />
      </FormDialogShell>
    </>
  );
}

test('dua dialog bertumpuk: Escape menutup dialog teratas saja', async () => {
  render(<Stacked />);
  await userEvent.click(await screen.findByRole('button', { name: 'Tambah merk' }));
  await screen.findByRole('alertdialog', { name: 'Dialog atas' });
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('alertdialog', { name: 'Dialog atas' })).toBeNull();
  expect(screen.getByRole('alertdialog', { name: 'Dialog bawah' })).toBeInTheDocument();
});

test('size lg memakai kelas lebar berbeda dari md', async () => {
  const { rerender } = render(
    <FormDialogShell open onOpenChange={() => undefined} formId="x" title="Judul" size="md">
      <form id="x" />
    </FormDialogShell>,
  );
  const md = (await screen.findByRole('alertdialog')).className;
  rerender(
    <FormDialogShell open onOpenChange={() => undefined} formId="x" title="Judul" size="lg">
      <form id="x" />
    </FormDialogShell>,
  );
  const lg = screen.getByRole('alertdialog').className;
  expect(lg).not.toBe(md);
  expect(lg).toContain('max-w-2xl');
  expect(md).toContain('max-w-lg');
});
