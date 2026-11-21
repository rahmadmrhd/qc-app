import type { PostelDto, SavePostelInput } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormPage } from '@/components/page/form-page';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { itemLinkAccess } from '@/lib/link-access';
import { meQueryOptions } from '@/modules/auth/queries';
import { isStaleSaveError, STALE_SAVE_MESSAGE } from '@/modules/sticker/lib/stale';
import { POSTEL_FIELD_KEYS, type PostelFieldErrors } from '../lib/schemas';
import { useSavePostel } from '../queries';
import { PostelForm, type PostelFormUiState } from './postel-form';

export const POSTEL_FORM_ID = 'postel-form';

export interface PostelFormPageProps {
  postel?: PostelDto | undefined;
  soonDays: number;
  today: string;
  /** Dipanggil (dan ditunggu) setelah simpan berhasil; biasanya menavigasi ke halaman Postel. */
  onDone: (id: string) => void | Promise<void>;
  onCancel: () => void;
}

/** Galat server per field yang dikenal form (`ApiError.fields`); kosong bila tak ada. */
function pickPostelFieldErrors(error: unknown): PostelFieldErrors {
  const result: PostelFieldErrors = {};
  if (!(error instanceof ApiError)) return result;
  for (const key of POSTEL_FIELD_KEYS) {
    const message = error.fields?.[key];
    if (message) result[key] = message;
  }
  return result;
}

/**
 * Halaman form Postel (`FormPage`: bar judul dengan Batal/Simpan di luar form): menyimpan lewat `useSavePostel` (hasil ditempel ke cache), toast, lalu `onDone`. Versi usang
 * memakai `STALE_SAVE_MESSAGE`; galat per field dipetakan ke field; galat lain tampil sebagai alert.
 */
export function PostelFormPage({ postel, soonDays, today, onDone, onCancel }: PostelFormPageProps) {
  const save = useSavePostel();
  // Tanpa suspense: data pengguna sudah dimuat cangkang; bila belum, baris Tambah item sekadar tak tampil.
  const me = useQuery(meQueryOptions()).data;
  const [fieldErrors, setFieldErrors] = useState<PostelFieldErrors>({});
  const [ui, setUi] = useState<PostelFormUiState>({ submitting: false, blocked: false });

  async function handleSubmit(input: SavePostelInput): Promise<string | null> {
    setFieldErrors({});
    try {
      const saved = await save.mutateAsync(input);
      toast.success('Postel disimpan');
      await onDone(saved.id);
      return null;
    } catch (error) {
      if (isStaleSaveError(error)) return STALE_SAVE_MESSAGE;
      const picked = pickPostelFieldErrors(error);
      if (Object.keys(picked).length > 0) {
        setFieldErrors(picked);
        return null;
      }
      return describeError(error);
    }
  }

  return (
    <FormPage
      formId={POSTEL_FORM_ID}
      title={postel ? `Ubah Postel: ${postel.name}` : 'Tambah Postel'}
      onCancel={onCancel}
      submitting={ui.submitting}
      submitDisabled={ui.blocked}
      busyText="Menyimpan Postel…"
    >
      <PostelForm
        formId={POSTEL_FORM_ID}
        onUiState={setUi}
        postel={postel}
        soonDays={soonDays}
        today={today}
        fieldErrors={fieldErrors}
        canCreateItem={itemLinkAccess(me).canCreate}
        onSubmit={handleSubmit}
      />
    </FormPage>
  );
}
