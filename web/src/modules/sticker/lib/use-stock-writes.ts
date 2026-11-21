import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import {
  type StockSaveResult,
  type StockWrite,
  stockSaveFailure,
} from '../components/stock-entry-dialog';
import { stickerKeys } from '../keys';
import { useAdjustStock, useRecordStock } from '../queries';

/**
 * Wiring penulisan stok tunggal (Catat masuk, Catat keluar, Koreksi) yang dipakai bersama halaman Stiker dan View
 * Stiker: satu implementasi, satu pemetaan galat. Galat apa pun memuat ulang stok (stok bisa berubah oleh orang lain,
 * mis. "Stok tidak cukup") agar angka yang tampil terbaru.
 */
export function useStockWrites() {
  const queryClient = useQueryClient();
  const record = useRecordStock();
  const adjust = useAdjustStock();

  const refetchStock = useCallback(
    () => queryClient.invalidateQueries({ queryKey: stickerKeys.stocks }),
    [queryClient],
  );

  const handleWrite = useCallback(
    async (write: StockWrite): Promise<StockSaveResult> => {
      try {
        if (write.type === 'record') await record.mutateAsync(write.input);
        else await adjust.mutateAsync(write.input);
        toast.success('Stok dicatat');
        return null;
      } catch (error) {
        void refetchStock();
        return stockSaveFailure(error);
      }
    },
    [record, adjust, refetchStock],
  );

  return { handleWrite, refetchStock };
}
