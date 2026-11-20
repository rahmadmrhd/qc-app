import type { ReactNode } from 'react';
import { ActionButton } from '@/components/action-button';
import { HeadroomBar, HeadroomFrame } from './headroom-bar';

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
}) {
  return (
    <HeadroomFrame className="gap-4">
      <HeadroomBar tour={tour} className="pt-1 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-xl font-semibold break-words">{title}</h1>
            {badge}
          </div>
          <div
            data-tour={actionsTour}
            className="flex flex-wrap items-center gap-2 max-md:w-full max-md:justify-end"
          >
            <ActionButton action="cancel" onClick={onCancel} disabled={submitting} />
            {extra}
            <ActionButton
              action="save"
              type="submit"
              form={formId}
              label={submitLabel}
              busy={submitting}
              busyLabel={busyText}
              disabled={submitDisabled}
              data-tour={saveTour}
            />
          </div>
        </div>
      </HeadroomBar>
      <div className="min-w-0">{children}</div>
    </HeadroomFrame>
  );
}
