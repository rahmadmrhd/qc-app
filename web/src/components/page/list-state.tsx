import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * Keadaan daftar yang seragam di semua halaman (spek redesain §6.12, butir 39): galat muat awal (pesan + "Coba lagi"),
 * kosong karena filter ("Tidak ada hasil untuk filter ini" + tombol hapus filter), kosong biasa (alasan + ajakan aksi,
 * mis. "Belum ada merk" + tombol Tambah), atau `children` (daftarnya). Kerangka muat (skeleton) tetap milik tampilan
 * yang bersangkutan (tabel, kartu, kisi) karena bentuknya mengikuti tampilan itu. Murni tampilan, tanpa data.
 */
export function ListState({
  isError,
  onRetry,
  errorText = 'Gagal memuat data. Coba muat ulang.',
  isEmpty,
  filtered,
  onClearFilters,
  empty = 'Tidak ada data yang cocok.',
  emptyAction,
  children,
}: {
  /** Galat muat AWAL (tanpa data); galat refetch tidak boleh menyembunyikan baris yang sudah ada. */
  isError?: boolean | undefined;
  onRetry?: (() => void) | undefined;
  errorText?: string;
  /** Tidak ada baris untuk ditampilkan (dan tidak sedang memuat). */
  isEmpty: boolean;
  /** Ada filter/pencarian aktif sehingga kosong berarti "tidak cocok", bukan "belum ada data". */
  filtered?: boolean | undefined;
  onClearFilters?: (() => void) | undefined;
  /** Alasan kosong biasa (belum ada data). */
  empty?: ReactNode;
  /** Ajakan aksi pada kosong biasa, mis. tombol Tambah. */
  emptyAction?: ReactNode;
  children: ReactNode;
}) {
  if (isError && isEmpty) {
    return (
      <Alert color="destructive" className="flex flex-wrap items-center gap-2">
        <span>{errorText}</span>
        {onRetry ? (
          <Button type="button" size="sm" variant="outline" color="primary" onClick={onRetry}>
            Coba lagi
          </Button>
        ) : null}
      </Alert>
    );
  }
  if (!isEmpty) return <>{children}</>;
  if (filtered) {
    return (
      <div
        data-slot="list-empty-filtered"
        className="flex flex-col items-center gap-3 rounded-lg border p-8 text-center text-sm text-muted-foreground"
      >
        <p>Tidak ada hasil untuk filter ini.</p>
        {onClearFilters ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            color="primary"
            onClick={onClearFilters}
          >
            Hapus filter
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div
      data-slot="list-empty"
      className="flex flex-col items-center gap-3 rounded-lg border p-8 text-center text-sm text-muted-foreground"
    >
      <div>{empty}</div>
      {emptyAction}
    </div>
  );
}
