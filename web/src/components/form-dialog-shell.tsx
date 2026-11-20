import type { ReactNode } from 'react';
import { ActionButton } from '@/components/action-button';
import {
  FormDialog,
  FormDialogContent,
  FormDialogDescription,
  FormDialogFooter,
  FormDialogHeader,
  FormDialogTitle,
} from '@/components/form-dialog';

export type FormDialogSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<FormDialogSize, string> = {
  sm: 'data-[size=default]:sm:max-w-sm',
  md: 'data-[size=default]:sm:max-w-lg',
  lg: 'data-[size=default]:sm:max-w-2xl',
  xl: 'data-[size=default]:sm:max-w-4xl',
};

/**
 * Dialog form: header (judul + keterangan), badan (komponen form `<form id={formId}>`), dan footer Batal + Simpan.
 * Tombol Simpan di footer berada di luar `<form>` dan men-submit lewat `form={formId}`, sehingga hanya form
 * dialog ini yang terkirim walau halaman di belakangnya juga punya form. Dialog "Tambah" bersarang dirender di
 * luar `<form>` induk (aturan CLAUDE.md); pada dialog bertumpuk Escape menutup yang teratas saja (lapisan Radix).
 */
export function FormDialogShell({
  open,
  onOpenChange,
  formId,
  title,
  description,
  submitting,
  submitDisabled,
  submitLabel = 'Simpan',
  size = 'md',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formId: string;
  title: ReactNode;
  description?: ReactNode;
  submitting?: boolean;
  /** Menonaktifkan Simpan tanpa tampil sibuk (mis. gambar masih diunggah). */
  submitDisabled?: boolean;
  submitLabel?: string;
  size?: FormDialogSize;
  children: ReactNode;
}) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent className={SIZE_CLASS[size]}>
        <FormDialogHeader>
          <FormDialogTitle>{title}</FormDialogTitle>
          {description ? <FormDialogDescription>{description}</FormDialogDescription> : null}
        </FormDialogHeader>
        {children}
        <FormDialogFooter>
          <ActionButton action="cancel" onClick={() => onOpenChange(false)} disabled={submitting} />
          <ActionButton
            action="save"
            type="submit"
            form={formId}
            label={submitLabel}
            busy={submitting}
            disabled={submitDisabled}
          />
        </FormDialogFooter>
      </FormDialogContent>
    </FormDialog>
  );
}
