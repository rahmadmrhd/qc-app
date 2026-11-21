import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import {
  type StickerSaveInput,
  type StickerSaveResult,
  stickerSaveFailure,
} from '../components/sticker-form-dialog';
import {
  type StickerTypeSaveInput,
  type StickerTypeSaveResult,
  stickerTypeSaveFailure,
} from '../components/sticker-type-form-dialog';
import { stickerKeys } from '../keys';
import { useSaveSticker, useSaveStickerType } from '../queries';
import { isStaleSaveError } from './stale';

/**
 * Simpan stiker untuk dialog tambah/ubah (halaman Stiker dan View Stiker): toast sukses, dan pada versi usang daftar
 * dimuat ulang agar form yang dibuka ulang memakai data terbaru. Mengembalikan galat dialog atau `null`.
 */
export function useStickerSave() {
  const queryClient = useQueryClient();
  const save = useSaveSticker();
  return useCallback(
    async (input: StickerSaveInput): Promise<StickerSaveResult> => {
      try {
        await save.mutateAsync(input);
        toast.success(input.id ? 'Stiker diperbarui' : 'Stiker ditambahkan');
        return null;
      } catch (error) {
        if (isStaleSaveError(error))
          void queryClient.invalidateQueries({ queryKey: stickerKeys.all });
        return stickerSaveFailure(error);
      }
    },
    [save, queryClient],
  );
}

/** Simpan jenis stiker untuk dialog tambah/ubah (halaman Jenis dan View Jenis); pola sama dengan `useStickerSave`. */
export function useStickerTypeSave() {
  const queryClient = useQueryClient();
  const save = useSaveStickerType();
  return useCallback(
    async (input: StickerTypeSaveInput): Promise<StickerTypeSaveResult> => {
      try {
        await save.mutateAsync(input);
        toast.success(input.id ? 'Jenis stiker diperbarui' : 'Jenis stiker ditambahkan');
        return null;
      } catch (error) {
        if (isStaleSaveError(error))
          void queryClient.invalidateQueries({ queryKey: stickerKeys.all });
        return stickerTypeSaveFailure(error);
      }
    },
    [save, queryClient],
  );
}
