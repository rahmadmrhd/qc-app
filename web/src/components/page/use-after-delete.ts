import { type LinkProps, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { toast } from 'sonner';

/**
 * Aksi sesudah Hapus dari halaman View berhasil: kembali ke indeks induk lalu toast "Dihapus" dengan aksi
 * "Pulihkan" hanya bila pemakai boleh memulihkan (spek redesain 6.6, keputusan perancang T22).
 */
export function useAfterDelete({
  indexTo,
  canRestore,
  onRestore,
}: {
  indexTo: LinkProps['to'];
  canRestore: boolean;
  onRestore?: () => void;
}): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    void navigate({ to: indexTo });
    toast.success(
      'Dihapus',
      canRestore && onRestore ? { action: { label: 'Pulihkan', onClick: onRestore } } : undefined,
    );
  }, [navigate, indexTo, canRestore, onRestore]);
}
