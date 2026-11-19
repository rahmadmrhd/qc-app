import type { ReactNode } from 'react';
import { ActionButton } from '@/components/action-button';

export interface FormHeaderProps {
  /** Judul halaman form (h1). */
  title: ReactNode;
  onCancel: () => void;
  /** Sedang menyimpan: tombol Simpan nonaktif dan berlabel "Menyimpan…". */
  submitting: boolean;
  submitLabel?: string;
  /** Menonaktifkan Simpan tanpa mengubah labelnya (mis. unggahan lampiran belum selesai). */
  submitDisabled?: boolean;
  /** Teks saat menyimpan, menyebut apa yang disimpan (bawaan "Menyimpan…"). */
  busyText?: string;
  /** Dipanggil saat tombol Simpan ditekan (sebelum submit), mis. untuk menandai mode simpan. */
  onSubmitClick?: () => void;
  /** Tombol aksi tambahan, ditampilkan di antara Batal dan Simpan. */
  extra?: ReactNode;
  /** Kelas tambahan untuk elemen bar (mis. `lg:col-span-2` bila form berupa grid). */
  className?: string;
  /** Penanda panduan interaktif (`data-tour`); dipasang pada pembungkus tombol aksi, bukan pada seluruh bar. */
  'data-tour'?: string;
}

/**
 * Bar judul dan aksi untuk form halaman penuh: menempel (sticky) tepat di bawah header aplikasi (tinggi 3,5 rem)
 * sehingga judul dan tombol simpan selalu terlihat saat form digulir. Harus berada DI DALAM elemen <form>
 * (tombol Simpan bertipe submit).
 */
export function FormHeader({
  title,
  onCancel,
  submitting,
  submitLabel = 'Simpan',
  submitDisabled = false,
  busyText = 'Menyimpan…',
  onSubmitClick,
  extra,
  className,
  'data-tour': dataTour,
}: FormHeaderProps) {
  return (
    <div
      data-testid="form-header"
      className={`sticky top-14 z-20 -mt-2 flex flex-wrap items-center justify-between gap-2 border-b bg-background/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80${className ? ` ${className}` : ''}`}
    >
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div data-tour={dataTour} className="flex flex-wrap items-center gap-2">
        <ActionButton action="cancel" onClick={onCancel} />
        {extra}
        <ActionButton
          action="save"
          type="submit"
          label={submitLabel}
          busy={submitting}
          busyLabel={busyText}
          disabled={submitDisabled}
          onClick={onSubmitClick}
        />
      </div>
    </div>
  );
}
