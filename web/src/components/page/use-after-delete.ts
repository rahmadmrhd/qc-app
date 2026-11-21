import type { LinkProps } from '@tanstack/react-router';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { useStackNavigation } from '@/hooks/use-stack-navigation';

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
  const stack = useStackNavigation();
  return useCallback(() => {
    // Hapus dari View = kembali ke daftar asal (pop; replace bila entri sebelumnya bukan daftar).
    stack.pop({ to: indexTo });
    toast.success(
      'Dihapus',
      canRestore && onRestore ? { action: { label: 'Pulihkan', onClick: onRestore } } : undefined,
    );
  }, [stack, indexTo, canRestore, onRestore]);
}
