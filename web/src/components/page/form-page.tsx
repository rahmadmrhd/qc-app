import type { ReactNode } from 'react';
import { ActionButton } from '@/components/action-button';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { HeadroomBar, HeadroomFrame } from './headroom-bar';
import { StickyActionBar } from './sticky-action-bar';

/**
 * Kerangka halaman form (spek redesain 6.7): bar headroom berisi judul (+ badge) dan aksi (Batal, tambahan, Simpan).
 * Komponen form model merender `<form id={formId}>` berisi field saja; tombol Simpan di sini berada di luar form
 * dan men-submit lewat `form={formId}`.
 */
export function FormPage({
  formId,
  title,
  badge,
  onCancel,
  submitting,
  submitLabel = 'Simpan',
  busyText = 'Menyimpan…',
  submitDisabled,
  extra,
  children,
  tour,
  actionsTour,
  saveTour,
  hideMobileBar,
}: {
  formId: string;
  title: ReactNode;
  badge?: ReactNode;
  onCancel: () => void;
  submitting?: boolean;
  submitLabel?: string;
  busyText?: string;
  submitDisabled?: boolean;
  /** Aksi tambahan di antara Batal dan Simpan. */
  extra?: ReactNode;
  children: ReactNode;
  /** `data-tour` pada bar judul. */
  tour?: string;
  /** `data-tour` pada pembungkus tombol. */
  actionsTour?: string;
  /** `data-tour` pada tombol Simpan. */
  saveTour?: string;
  /**
   * Ponsel: sembunyikan bar bawah (Batal + Simpan) sementara halaman menampilkan bar aksi lain di tepi bawah, mis. bar
   * aksi pilihan pada tabel draft. Tak berpengaruh di desktop.
   */
  hideMobileBar?: boolean;
}) {
  const desktop = useIsDesktop();
  const cancel = <ActionButton action="cancel" onClick={onCancel} disabled={submitting} />;
  const save = (
    <ActionButton
      action="save"
      type="submit"
      form={formId}
      label={submitLabel}
      busy={submitting}
      busyLabel={busyText}
      disabled={submitDisabled}
      data-tour={saveTour}
      className={desktop ? undefined : 'flex-[2]'}
    />
  );
  return (
    <HeadroomFrame className="gap-4">
      <HeadroomBar tour={tour} className="pt-1 pb-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Ponsel: tanpa tombol kembali dan tanpa judul tampak (judul navbar; kembali = tombol sistem). */}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-xl font-semibold break-words narrow:sr-only">{title}</h1>
            {badge}
          </div>
          {desktop ? (
            <div data-tour={actionsTour} className="flex flex-wrap items-center gap-2">
              {cancel}
              {extra}
              {save}
            </div>
          ) : null}
        </div>
      </HeadroomBar>
      <div className="min-w-0">{children}</div>
      {desktop || hideMobileBar ? null : (
        // Ponsel: Batal + Simpan pindah ke bar bawah `fixed` (Simpan lebih lebar).
        <StickyActionBar label="Aksi form">
          <div data-tour={actionsTour} className="flex w-full items-center gap-2">
            {cancel}
            {extra}
            {save}
          </div>
        </StickyActionBar>
      )}
    </HeadroomFrame>
  );
}
