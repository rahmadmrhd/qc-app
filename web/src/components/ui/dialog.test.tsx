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

test('AlertDialog size="full": layar penuh tanpa sudut/jarak, badan tanpa padding, header dan footer tetap di penggulir', () => {
  render(
    <AlertDialog open>
      <AlertDialogContent size="full">
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
  expect(shell).toHaveAttribute('data-size', 'full');
  for (const token of ['h-dvh', 'w-screen', 'max-w-none', 'rounded-none', 'inset-0']) {
    expect(shell.className).toContain(token);
  }
  // Area aman (notch, bilah gestur) dihormati di cangkang.
  expect(shell.className).toContain('env(safe-area-inset-top)');
  expect(shell.className).toContain('env(safe-area-inset-bottom)');
  const scroller = shell.querySelector('[data-slot="alert-dialog-scroll"]');
  expect(scroller?.className).toContain('p-0');
  expect(scroller?.className).not.toContain('p-4');
  expect(scroller?.contains(screen.getByText('Isi'))).toBe(true);
});

test('AlertDialog bawaan tidak berubah: tanpa kelas layar penuh', () => {
  render(
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogTitle>Judul</AlertDialogTitle>
        <AlertDialogDescription>Deskripsi</AlertDialogDescription>
      </AlertDialogContent>
    </AlertDialog>,
  );
  const shell = screen.getByRole('alertdialog');
  expect(shell).toHaveAttribute('data-size', 'default');
  expect(shell.className).not.toMatch(/(^| )h-dvh/);
});

test('Dialog size="full-on-phone": kelas layar penuh khusus ponsel (max-md, dvh, area aman, papan ketik); ukuran desktop tak hilang', () => {
  render(
    <Dialog open>
      <DialogContent size="full-on-phone" className="sm:max-w-5xl">
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
  expect(shell).toHaveAttribute('data-size', 'full-on-phone');
  for (const token of [
    'h-[var(--vvh,100dvh)]',
    'top-[var(--vv-top,0px)]',
    'w-screen',
    'max-w-none',
    'max-h-none',
    'rounded-none',
    'pt-[env(safe-area-inset-top)]',
    'pb-[env(safe-area-inset-bottom)]',
    // Bar fixed di dalamnya jangan menaikkan dua kali: dialog sudah mengecil mengikuti papan ketik lewat --vvh.
    '[--kb:0px]',
  ]) {
    expect(shell.className).toContain(`max-md:data-[size=full-on-phone]:${token}`);
  }
  // Desktop: kelas ukuran pemakai tetap ada dan tidak dihapus oleh kelas ponsel.
  expect(shell.className).toContain('sm:max-w-5xl');
  expect(shell.className).toContain('max-h-[calc(100dvh-2rem)]');
  // Header/footer tetap menempel di dalam penggulir; tombol tutup bergeser di bawah area aman atas.
  const scroller = shell.querySelector('[data-slot="dialog-scroll"]');
  expect(scroller?.contains(shell.querySelector('[data-slot="dialog-header"]'))).toBe(true);
  expect(shell.querySelector('[data-slot="dialog-footer"]')?.className).toContain('sticky');
  expect(screen.getByRole('button', { name: 'Close' }).className).toContain(
    'max-md:top-[calc(0.5rem+env(safe-area-inset-top))]',
  );
});

// R11: ruang gulir daftar saran (`--list-room`) tidak boleh menjadi padding penggulir bila ada footer sticky, sebab
// kotak penampung sticky = kotak isi: footer ikut terangkat dengan celah di bawahnya. Ruangnya elemen pengikut tepat
// sebelum footer di alur isi; dialog tanpa footer tetap memakai padding bawah sebagai cadangan.
test('Dialog: ruang gulir daftar saran dipasang sebagai elemen sebelum footer, padding bawah hanya cadangan tanpa footer', () => {
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
  const scroller = screen.getByRole('dialog').querySelector('[data-slot="dialog-scroll"]');
  const room = scroller?.querySelector('[data-slot="dialog-list-room"]');
  const footer = scroller?.querySelector('[data-slot="dialog-footer"]');
  expect(room).not.toBeNull();
  expect(room?.className).toContain('h-[var(--list-room,0px)]');
  // Menetralkan jarak antaranak penggulir agar tanpa ruang tak ada celah tambahan di atas footer.
  expect(room?.className).toContain('-mb-[var(--dialog-gap,1rem)]');
  // Tepat sebelum footer, di dalam alur penggulir yang sama.
  expect(room?.nextElementSibling).toBe(footer);
  // Dengan footer, padding bawah penggulir tetap 1rem (cadangan hanya untuk dialog tanpa footer sticky).
  expect(scroller?.className).toContain('has-[[data-slot=dialog-footer]');
  expect(scroller?.className).toContain(':pb-4');
  expect(scroller?.className).toContain('[--dialog-gap:1rem]');
  expect(screen.queryByText('Isi')?.parentElement).toBe(scroller);
});

test('Dialog tanpa footer: padding bawah memuat --list-room agar field dapat digulir ke atas', () => {
  render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>Judul</DialogTitle>
        <DialogDescription>Deskripsi</DialogDescription>
      </DialogContent>
    </Dialog>,
  );
  const scroller = screen.getByRole('dialog').querySelector('[data-slot="dialog-scroll"]');
  expect(scroller?.className).toContain('pb-[calc(1rem+var(--list-room,0px))]');
  expect(scroller?.querySelector('[data-slot="dialog-list-room"]')).toBeNull();
});

test('AlertDialog: elemen ruang gulir sebelum footer; layar penuh tanpa ruang gulir (tanpa padding)', () => {
  const { unmount } = render(
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
  const scroller = shell.querySelector('[data-slot="alert-dialog-scroll"]');
  const room = scroller?.querySelector('[data-slot="alert-dialog-list-room"]');
  expect(room?.className).toContain('h-[var(--list-room,0px)]');
  expect(room?.nextElementSibling).toBe(shell.querySelector('[data-slot="alert-dialog-footer"]'));
  expect(scroller?.className).toContain('has-[[data-slot=dialog-footer],[data-slot=alert-dialog-footer]');
  unmount();

  render(
    <AlertDialog open>
      <AlertDialogContent size="full">
        <AlertDialogTitle>Judul</AlertDialogTitle>
        <AlertDialogDescription>Deskripsi</AlertDialogDescription>
        <AlertDialogFooter>
          <button type="button">Ya</button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>,
  );
  const fullScroller = screen.getByRole('alertdialog').querySelector('[data-slot="alert-dialog-scroll"]');
  expect(fullScroller?.className).toContain('p-0');
  expect(fullScroller?.className).toContain('[--dialog-gap:0px]');
  expect(fullScroller?.className).not.toContain('list-room');
});

test('Dialog bawaan tidak berubah: tanpa kelas layar penuh ponsel', () => {
  render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>Judul</DialogTitle>
        <DialogDescription>Deskripsi</DialogDescription>
      </DialogContent>
    </Dialog>,
  );
  const shell = screen.getByRole('dialog');
  expect(shell).toHaveAttribute('data-size', 'default');
  expect(shell.className).not.toContain('full-on-phone');
  expect(screen.getByRole('button', { name: 'Close' }).className).not.toContain('safe-area-inset-top');
});
