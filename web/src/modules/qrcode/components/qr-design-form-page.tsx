import { useState } from 'react';
import { ActionButton } from '@/components/action-button';
import { FormPage } from '@/components/page/form-page';
import { QrDesignForm, type QrDesignFormProps, type QrFormUiState } from './qr-design-form';

export const QR_FORM_ID = 'qr-design-form';

type PassThrough = Omit<
  QrDesignFormProps,
  'formId' | 'onUiState' | 'activeTab' | 'onActiveTabChange'
>;

export interface QrDesignFormPageProps extends PassThrough {
  title: string;
  onCancel: () => void;
  /** Tampilkan "Simpan dan ekspor" (hanya konfigurasi QR, bukan konfigurasi default; butuh `qrcode: edit`). */
  canExport?: boolean;
  /** Teks proses simpan pada tombol. */
  busyText?: string;
}

/**
 * Halaman Tambah/Ubah konfigurasi QR: `FormPage` (bar judul + Batal/Simpan) membungkus `QrDesignForm` bertab. Tombol
 * di bar berada di luar `<form>` dan men-submit lewat `form={formId}`; "Simpan dan ekspor" membawa penanda
 * `data-export` yang dibaca form dari tombol pengirim, jadi Simpan biasa tak pernah membawa tujuan ekspor.
 */
export function QrDesignFormPage({
  title,
  onCancel,
  canExport = false,
  busyText = 'Menyimpan konfigurasi…',
  ...formProps
}: QrDesignFormPageProps) {
  const [ui, setUi] = useState<QrFormUiState>({
    submitting: false,
    blocked: false,
    overflow: false,
  });
  const isDefaults = formProps.mode === 'defaults';
  return (
    <FormPage
      formId={QR_FORM_ID}
      title={title}
      onCancel={onCancel}
      submitting={ui.submitting}
      submitDisabled={ui.blocked}
      busyText={busyText}
      submitLabel={isDefaults ? 'Simpan default' : 'Simpan'}
      saveTour="qr-save"
      extra={
        canExport && !isDefaults ? (
          <ActionButton
            action="export"
            type="submit"
            form={QR_FORM_ID}
            label="Simpan dan ekspor"
            data-export="true"
            disabled={ui.blocked || ui.submitting || ui.overflow}
          />
        ) : undefined
      }
    >
      <QrDesignForm formId={QR_FORM_ID} onUiState={setUi} {...formProps} />
    </FormPage>
  );
}
