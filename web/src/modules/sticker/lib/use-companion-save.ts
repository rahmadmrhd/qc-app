import type { SavePostelInput } from '@shared/contract';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { useSavePostel } from '@/modules/postel/queries';
import type { QrSubmitOptions } from '@/modules/qrcode/components/qr-design-form';
import { useSaveQrDesign } from '@/modules/qrcode/queries';
import type { QrFormOutput } from '@/modules/qrcode/schemas';
import { toSaveQrDesignInput } from '@/modules/qrcode/schemas';
import type { CompanionSaveResult } from '../components/sticker-form-dialog';

function failure(error: unknown): CompanionSaveResult {
  const fields = error instanceof ApiError ? error.fields : undefined;
  return { message: describeError(error), ...(fields ? { fields } : {}) };
}

/**
 * Simpan dari form pembuatan Stiker berjenis Postel/Manual Book (keputusan pemilik 2026-11-25). Postel = SATU panggilan
 * `postels.save` (stiker lahir bersama catatannya dan menerima alias/minimum/gambar/stok awal di batch yang sama, jadi
 * tak ada stiker ganda dan tak ada kegagalan sebagian). Manual Book = `qrcodes.save` saja: stikernya baru lahir saat QR
 * diekspor, jadi `onSavedQr` (mis. membuka konfigurasi QR untuk diekspor) menerima id konfigurasinya.
 */
export function useCompanionSave(onSavedQr?: (designId: string) => void) {
  const savePostel = useSavePostel();
  const saveQr = useSaveQrDesign();
  const postel = useCallback(
    async (input: SavePostelInput): Promise<CompanionSaveResult> => {
      try {
        await savePostel.mutateAsync(input);
        toast.success('Postel dan stikernya ditambahkan');
        return null;
      } catch (error) {
        return failure(error);
      }
    },
    [savePostel],
  );
  const manualBook = useCallback(
    async (values: QrFormOutput, options: QrSubmitOptions): Promise<CompanionSaveResult> => {
      try {
        const saved = await saveQr.mutateAsync(
          toSaveQrDesignInput(values, undefined, undefined, options.overflow),
        );
        toast.success('Konfigurasi QR Manual Book disimpan', {
          description: 'Stiker Manual Book terbentuk setelah QR diekspor.',
          ...(onSavedQr
            ? { action: { label: 'Buka untuk ekspor', onClick: () => onSavedQr(saved.id) } }
            : {}),
        });
        return null;
      } catch (error) {
        return failure(error);
      }
    },
    [saveQr, onSavedQr],
  );
  return { postel, manualBook };
}
