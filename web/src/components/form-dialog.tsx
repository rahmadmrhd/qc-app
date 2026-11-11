import { XIcon } from 'lucide-react';
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import type * as React from 'react';
import { useRef } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DialogFooter, DialogHeader } from '@/components/ui/dialog';

/**
 * Dialog untuk form: dibangun di atas AlertDialog Radix sehingga klik di luar (overlay) TIDAK menutupnya dan isian
 * tidak hilang tak sengaja. Ditutup lewat tombol X, tombol Batal, atau Escape. Header/footer memakai komponen polos
 * milik `ui/dialog` (tanpa konteks Radix); judul dan deskripsi memakai versi AlertDialog.
 */
const FormDialog = AlertDialog;
const FormDialogHeader = DialogHeader;
const FormDialogFooter = DialogFooter;
const FormDialogTitle = AlertDialogTitle;
const FormDialogDescription = AlertDialogDescription;

function FormDialogContent({
  className,
  children,
  onOpenAutoFocus,
  'aria-describedby': describedBy,
  ...props
}: React.ComponentProps<typeof AlertDialogContent>) {
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <AlertDialogContent
      ref={contentRef}
      className={`data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-sm ${className ?? ''}`}
      // Bawaan AlertDialog memfokuskan tombol Batal; form lebih baik memfokus isian pertama.
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        contentRef.current
          ?.querySelector<HTMLElement>(
            'input:not([type=hidden]), textarea, select, [role=combobox]',
          )
          ?.focus();
      }}
      aria-describedby={describedBy}
      {...props}
    >
      {children}
      <AlertDialogPrimitive.Cancel asChild>
        <Button variant="ghost" className="absolute top-2 right-2 z-20" size="icon-sm">
          <XIcon />
          <span className="sr-only">Tutup</span>
        </Button>
      </AlertDialogPrimitive.Cancel>
    </AlertDialogContent>
  );
}

export {
  FormDialog,
  FormDialogContent,
  FormDialogDescription,
  FormDialogFooter,
  FormDialogHeader,
  FormDialogTitle,
};
