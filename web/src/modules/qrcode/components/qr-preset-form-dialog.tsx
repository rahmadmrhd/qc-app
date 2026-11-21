import type { BusinessUnitOptionDto, QrPresetDto } from '@shared/contract';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { describeError } from '@/lib/api/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { useSaveQrPreset } from '../queries';
import type { QrFormOutput, QrPresetFieldErrors } from '../schemas';
import { QR_PRESET_FIELD_KEYS, toPresetFormValues, toSaveQrPresetInput } from '../schemas';
import { QrDesignForm, type QrFormUiState } from './qr-design-form';

const PRESET_DIALOG_FORM_ID = 'qr-preset-dialog-form';

export interface QrPresetFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** BU yang dapat dipilih sebagai pemilik preset baru (satu preset per BU: yang sudah punya preset tak ditawarkan). */
  businessUnits: readonly BusinessUnitOptionDto[];
  /** Pustaka logo bersama untuk logo awal. */
  logoLibrary: readonly string[];
  /** Dipanggil setelah preset tersimpan; dialog menutup sendiri. */
  onCreated: (preset: QrPresetDto) => void;
}

/**
 * Dialog "Tambah preset" (konfigurasi default baru): form bertab yang sama dengan halaman Tambah default, di dalam
 * `FormDialogShell`. Dirender pemanggil di LUAR `<form>` induk (form QR); submit dialog tak naik ke form itu.
 * Pemanggil memasangnya hanya saat dibuka (`{open ? <QrPresetFormDialog open … /> : null}`), jadi isian dan galat
 * selalu mulai bersih.
 */
export function QrPresetFormDialog({
  open,
  onOpenChange,
  businessUnits,
  logoLibrary,
  onCreated,
}: QrPresetFormDialogProps) {
  const save = useSaveQrPreset();
  const [ui, setUi] = useState<QrFormUiState>({
    submitting: false,
    blocked: false,
    overflow: false,
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<QrPresetFieldErrors>({});

  async function handleSubmit(values: QrFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      const saved = await save.mutateAsync(toSaveQrPresetInput(values));
      toast.success('Konfigurasi default disimpan');
      onOpenChange(false);
      onCreated(saved);
    } catch (error) {
      const picked = pickFieldErrors(error, QR_PRESET_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  return (
    <FormDialogShell
      open={open}
      onOpenChange={onOpenChange}
      formId={PRESET_DIALOG_FORM_ID}
      title="Tambah konfigurasi default"
      description="Konfigurasi default milik satu Business Unit; QR baru dari item BU itu terisi darinya."
      submitting={ui.submitting}
      submitDisabled={ui.blocked}
      submitLabel="Simpan default"
      size="xl"
    >
      <QrDesignForm
        formId={PRESET_DIALOG_FORM_ID}
        onUiState={setUi}
        mode="defaults"
        defaultValues={toPresetFormValues()}
        logoLibrary={logoLibrary}
        businessUnits={businessUnits}
        takenBuIds={new Set()}
        submitError={submitError}
        fieldErrors={fieldErrors}
        onSubmit={handleSubmit}
      />
    </FormDialogShell>
  );
}
