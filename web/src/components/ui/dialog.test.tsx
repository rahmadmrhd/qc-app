import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// jsdom tidak menata letak: yang diuji adalah struktur (badan di dalam penggulir, header/footer menempel) yang
// membuat cangkang dialog tidak pernah di-scroll sementara badan di-scroll.

test('Dialog: cangkang tidak di-scroll, badan di dalam penggulir, header dan footer menempel', () => {
  render(
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Judul</DialogTitle>
          <DialogDescription>Deskripsi</DialogDescription>
        </DialogHeader>
        <p>Isi</p>
        <DialogFooter>
          <button type="button">Simpan</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  );
  const shell = screen.getByRole('dialog');
  expect(shell.className).toContain('overflow-hidden');
  expect(shell.className).toContain('max-h-[calc(100dvh-2rem)]');
  const scroller = shell.querySelector('[data-slot="dialog-scroll"]');
  expect(scroller).not.toBeNull();
  expect(scroller?.className).toContain('overflow-y-auto');
  expect(scroller?.contains(screen.getByText('Isi'))).toBe(true);
  const header = shell.querySelector('[data-slot="dialog-header"]');
  const footer = shell.querySelector('[data-slot="dialog-footer"]');
  expect(scroller?.contains(header)).toBe(true);
  expect(scroller?.contains(footer)).toBe(true);
  expect(header?.className).toContain('sticky');
  expect(footer?.className).toContain('sticky');
  // Tombol tutup berada di luar penggulir agar tidak ikut tergulir.
  const close = screen.getByRole('button', { name: 'Close' });
  expect(scroller?.contains(close)).toBe(false);
});

test('AlertDialog: cangkang tidak di-scroll, badan di dalam penggulir, header dan footer menempel', () => {
  render(
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Judul</AlertDialogTitle>
          <AlertDialogDescription>Deskripsi</AlertDialogDescription>
        </AlertDialogHeader>
        <p>Isi</p>
        <AlertDialogFooter>
          <button type="button">Ya</button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>,
  );
  const shell = screen.getByRole('alertdialog');
  expect(shell.className).toContain('overflow-hidden');
  const scroller = shell.querySelector('[data-slot="alert-dialog-scroll"]');
  expect(scroller?.className).toContain('overflow-y-auto');
  expect(scroller?.contains(screen.getByText('Isi'))).toBe(true);
  expect(shell.querySelector('[data-slot="alert-dialog-header"]')?.className).toContain('sticky');
  expect(shell.querySelector('[data-slot="alert-dialog-footer"]')?.className).toContain('sticky');
});

test('Dialog: teks tanpa spasi (nama berkas panjang) dibungkus dan tidak membuat penggulir meluap ke samping', () => {
  render(
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Judul_tanpa_spasi_yang_sangat_panjang</DialogTitle>
          <DialogDescription>OWASP_Application_Security_Verification_Standard_5.0.0_id.pdf</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>,
  );
  const shell = screen.getByRole('dialog');
  expect(shell.querySelector('[data-slot="dialog-scroll"]')?.className).toContain('overflow-x-hidden');
  expect(shell.querySelector('[data-slot="dialog-title"]')?.className).toContain('wrap-anywhere');
  expect(shell.querySelector('[data-slot="dialog-description"]')?.className).toContain('wrap-anywhere');
});
