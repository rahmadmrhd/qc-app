import type { PostelDto, SavePostelInput } from '@shared/contract';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { isStaleSaveError, STALE_SAVE_MESSAGE } from '@/modules/sticker/lib/stale';
import { POSTEL_FIELD_KEYS, type PostelFieldErrors } from '../lib/schemas';
import { useSavePostel } from '../queries';
import { PostelForm } from './postel-form';

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
 * Halaman form Postel: menyimpan lewat `useSavePostel` (hasil ditempel ke cache), toast, lalu `onDone`. Versi usang
 * memakai `STALE_SAVE_MESSAGE`; galat per field dipetakan ke field; galat lain tampil sebagai alert.
 */
export function PostelFormPage({ postel, soonDays, today, onDone, onCancel }: PostelFormPageProps) {
  const save = useSavePostel();
  const [fieldErrors, setFieldErrors] = useState<PostelFieldErrors>({});

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
    <PostelForm
      postel={postel}
      soonDays={soonDays}
      today={today}
      fieldErrors={fieldErrors}
      onSubmit={handleSubmit}
      onCancel={onCancel}
    />
  );
}
