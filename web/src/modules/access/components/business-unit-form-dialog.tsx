import type { SaveBusinessUnitInput } from '@shared/contract';
import { useState } from 'react';
import {
  FormDialog,
  FormDialogContent,
  FormDialogHeader,
  FormDialogTitle,
} from '@/components/form-dialog';
import { describeError } from '@/lib/api/describe-error';
import { pickFieldErrors } from '../lib/field-errors';
import { toBusinessUnitFormDefaults } from '../schemas';
import { BusinessUnitForm } from './business-unit-form';

export interface BusinessUnitFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Membuat BU baru; melempar galat bila gagal (pesannya tampil di dialog). Dialog menutup sendiri saat berhasil. */
  onSave: (input: SaveBusinessUnitInput) => Promise<unknown>;
}

/** Dialog "Tambah BU" yang dipakai dari field BU di form item (hanya untuk pemegang `access: manage`). */
export function BusinessUnitFormDialog({
  open,
  onOpenChange,
  onSave,
}: BusinessUnitFormDialogProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ code?: string; name?: string }>({});

  function close() {
    setSubmitError(null);
    setFieldErrors({});
    onOpenChange(false);
  }

  async function handleSubmit(values: { code: string; name: string }) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await onSave(values);
      close();
    } catch (error) {
      const picked = pickFieldErrors(error, ['code', 'name'] as const);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  return (
    <FormDialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <FormDialogContent>
        <FormDialogHeader>
          <FormDialogTitle>Tambah BU</FormDialogTitle>
        </FormDialogHeader>
        {open ? (
          <BusinessUnitForm
            mode="create"
            defaultValues={toBusinessUnitFormDefaults()}
            submitError={submitError}
            fieldErrors={fieldErrors}
            onSubmit={handleSubmit}
            onCancel={close}
          />
        ) : null}
      </FormDialogContent>
    </FormDialog>
  );
}
