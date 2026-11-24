import type { LocationDto, SaveLocationInput } from '@shared/contract';
import { useState } from 'react';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { useFrozen } from '@/hooks/use-frozen';
import { pickFieldErrors } from '../lib/field-errors';
import { describeSaveError } from '../lib/stale';
import { toLocationFormDefaults } from '../schemas';
import { LocationForm } from './location-form';

export const LOCATION_FORM_ID = 'location-form';

export interface LocationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lokasi yang diubah; kosong = lokasi baru. */
  location?: (Pick<LocationDto, 'id' | 'code' | 'name'> & { updatedAt?: string }) | undefined;
  /** Menyimpan; melempar galat bila gagal (pesannya tampil di dialog). Dialog menutup sendiri saat berhasil. */
  onSave: (input: SaveLocationInput) => Promise<unknown>;
}

function LocationDialogBody({
  location: liveLocation,
  onSave,
  onClose,
  onBusyChange,
}: {
  location: LocationFormDialogProps['location'];
  onSave: LocationFormDialogProps['onSave'];
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  // Rekaman dibekukan saat badan dialog terpasang (hanya saat dialog terbuka): isi form dan versi (`updatedAt`) yang dikirim
  // sebagai `expectedUpdatedAt` selalu pasangan yang sama, walau query record dimuat ulang (polling 30 dtk, invalidasi
  // setelah 412). Buka-tutup-buka = rekaman segar.
  const location = useFrozen(liveLocation);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ code?: string; name?: string }>({});

  async function handleSubmit(values: { code: string; name: string }) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await onSave(
        location
          ? {
              ...values,
              id: location.id,
              ...(location.updatedAt ? { expectedUpdatedAt: location.updatedAt } : {}),
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
    <LocationForm
      formId={LOCATION_FORM_ID}
      mode={location ? 'edit' : 'create'}
      defaultValues={toLocationFormDefaults(location)}
      submitError={submitError}
      fieldErrors={fieldErrors}
      onSubmit={handleSubmit}
      onBusyChange={onBusyChange}
    />
  );
}

/**
 * Dialog tambah/ubah lokasi (`FormDialogShell`): dipakai halaman Lokasi, View lokasi, dan baris "Tambah lokasi" pada
 * penugasan di form pengguna (dirender di luar `<form>` pemanggil). Isian dan galat dibuang tiap dialog ditutup.
 */
export function LocationFormDialog({
  open,
  onOpenChange,
  location,
  onSave,
}: LocationFormDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <FormDialogShell
      open={open}
      onOpenChange={onOpenChange}
      formId={LOCATION_FORM_ID}
      title={location ? `Ubah lokasi ${location.name}` : 'Tambah lokasi'}
      size="sm"
      submitting={busy}
    >
      {open ? (
        <LocationDialogBody
          key={location?.id ?? 'new'}
          location={location}
          onSave={onSave}
          onClose={() => onOpenChange(false)}
          onBusyChange={setBusy}
        />
      ) : null}
    </FormDialogShell>
  );
}
