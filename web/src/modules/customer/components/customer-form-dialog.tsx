import type { CustomerDto, RenameCustomerInput } from '@shared/contract';
import { useState } from 'react';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { describeError } from '@/lib/api/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { toCustomerFormDefaults } from '../schemas';
import { CustomerForm } from './customer-form';

export const CUSTOMER_FORM_ID = 'customer-form';

export interface CustomerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Customer yang diganti namanya. */
  customer: Pick<CustomerDto, 'id' | 'name'> | undefined;
  /** Menyimpan (`customers.rename`); melempar galat bila gagal (pesannya tampil di dialog). Dialog menutup sendiri saat berhasil. */
  onSave: (input: RenameCustomerInput) => Promise<unknown>;
}

function CustomerDialogBody({
  customer,
  onSave,
  onClose,
  onBusyChange,
}: {
  customer: Pick<CustomerDto, 'id' | 'name'>;
  onSave: CustomerFormDialogProps['onSave'];
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string }>({});

  async function handleSubmit(values: { name: string }) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await onSave({ id: customer.id, name: values.name });
      onClose();
    } catch (error) {
      const picked = pickFieldErrors(error, ['name'] as const);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  return (
    <CustomerForm
      formId={CUSTOMER_FORM_ID}
      defaultValues={toCustomerFormDefaults(customer)}
      submitError={submitError}
      fieldErrors={fieldErrors}
      onSubmit={handleSubmit}
      onBusyChange={onBusyChange}
    />
  );
}

/**
 * Dialog ubah customer (`FormDialogShell`, satu field Nama): halaman Customer dan View customer. Tidak ada "Tambah":
 * customer dibuat otomatis saat task serah terima disimpan. Isian dan galat dibuang tiap dialog ditutup.
 */
export function CustomerFormDialog({
  open,
  onOpenChange,
  customer,
  onSave,
}: CustomerFormDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <FormDialogShell
      open={open}
      onOpenChange={onOpenChange}
      formId={CUSTOMER_FORM_ID}
      title={customer ? `Ubah customer ${customer.name}` : 'Ubah customer'}
      size="sm"
      submitting={busy}
    >
      {open && customer ? (
        <CustomerDialogBody
          key={customer.id}
          customer={customer}
          onSave={onSave}
          onClose={() => onOpenChange(false)}
          onBusyChange={setBusy}
        />
      ) : null}
    </FormDialogShell>
  );
}
