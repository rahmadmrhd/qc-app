import type { BusinessUnitDto, SaveBusinessUnitInput } from '@shared/contract';
import { useState } from 'react';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { useFrozen } from '@/hooks/use-frozen';
import { pickFieldErrors } from '../lib/field-errors';
import { describeSaveError } from '../lib/stale';
import { toBusinessUnitFormDefaults } from '../schemas';
import { BusinessUnitForm } from './business-unit-form';

export const BUSINESS_UNIT_FORM_ID = 'business-unit-form';

export interface BusinessUnitFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** BU yang diubah; kosong = BU baru. */
  businessUnit?:
    | (Pick<BusinessUnitDto, 'id' | 'code' | 'name'> & { updatedAt?: string })
    | undefined;
  /** Menyimpan; melempar galat bila gagal (pesannya tampil di dialog). Dialog menutup sendiri saat berhasil. */
  onSave: (input: SaveBusinessUnitInput) => Promise<unknown>;
}

function BusinessUnitDialogBody({
  businessUnit: liveBusinessUnit,
  onSave,
  onClose,
  onBusyChange,
}: {
  businessUnit: BusinessUnitFormDialogProps['businessUnit'];
  onSave: BusinessUnitFormDialogProps['onSave'];
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  // Rekaman dibekukan saat badan dialog terpasang (hanya saat dialog terbuka): isi form dan versi (`updatedAt`) yang dikirim
  // sebagai `expectedUpdatedAt` selalu pasangan yang sama, walau query record dimuat ulang (polling 30 dtk, invalidasi
  // setelah 412). Buka-tutup-buka = rekaman segar.
  const businessUnit = useFrozen(liveBusinessUnit);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ code?: string; name?: string }>({});

  async function handleSubmit(values: { code: string; name: string }) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await onSave(
        businessUnit
          ? {
              ...values,
              id: businessUnit.id,
              ...(businessUnit.updatedAt ? { expectedUpdatedAt: businessUnit.updatedAt } : {}),
            }
          : values,
      );
      onClose();
    } catch (error) {
      const picked = pickFieldErrors(error, ['code', 'name'] as const);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeSaveError(error));
    }
  }

  return (
    <BusinessUnitForm
      formId={BUSINESS_UNIT_FORM_ID}
      mode={businessUnit ? 'edit' : 'create'}
      defaultValues={toBusinessUnitFormDefaults(businessUnit)}
      submitError={submitError}
      fieldErrors={fieldErrors}
      onSubmit={handleSubmit}
      onBusyChange={onBusyChange}
    />
  );
}

/**
 * Dialog tambah/ubah BU (`FormDialogShell`): dipakai halaman BU, View BU, baris "Tambah BU" pada field BU (form merk,
 * form pengguna; dirender di luar `<form>` pemanggil). Isian dan galat dibuang tiap dialog ditutup.
 */
export function BusinessUnitFormDialog({
  open,
  onOpenChange,
  businessUnit,
  onSave,
}: BusinessUnitFormDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <FormDialogShell
      open={open}
      onOpenChange={onOpenChange}
      formId={BUSINESS_UNIT_FORM_ID}
      title={businessUnit ? `Ubah BU ${businessUnit.name}` : 'Tambah BU'}
      size="sm"
      submitting={busy}
    >
      {open ? (
        <BusinessUnitDialogBody
          key={businessUnit?.id ?? 'new'}
          businessUnit={businessUnit}
          onSave={onSave}
          onClose={() => onOpenChange(false)}
          onBusyChange={setBusy}
        />
      ) : null}
    </FormDialogShell>
  );
}
