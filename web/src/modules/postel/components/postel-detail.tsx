import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { dropPostelDetail, postelQueryOptions, useRemovePostel } from '../queries';
import { PostelHistory } from './postel-history';
import { PostelView } from './postel-view';

export interface PostelDetailProps {
  postelId: string;
  canEdit: boolean;
  /** Kembali ke daftar; juga dipanggil (dan ditunggu) setelah hapus berhasil. */
  onBack: () => void | Promise<void>;
  onEdit: () => void;
}

/**
 * Halaman detail Postel: tampilan baca + riwayat + alur hapus. Setelah hapus berhasil: toast, navigasi keluar, BARU
 * cache detail/riwayat id itu dibuang (membuangnya saat masih ter-mount memicu muat ulang id yang sudah terhapus).
 */
export function PostelDetail({ postelId, canEdit, onBack, onEdit }: PostelDetailProps) {
  const queryClient = useQueryClient();
  const { data: postel } = useSuspenseQuery(postelQueryOptions(postelId));
  const remove = useRemovePostel();
  // Tetap true sampai navigasi keluar selesai: jendela antara mutasi sukses dan pelepasan halaman juga terkunci.
  const [deleting, setDeleting] = useState(false);

  async function handleRemove() {
    if (remove.isPending || deleting) return;
    setDeleting(true);
    try {
      await remove.mutateAsync({ id: postel.id });
    } catch (error) {
      toast.error(describeError(error));
      setDeleting(false);
      return;
    }
    toast.success('Catatan Postel dihapus');
    try {
      await onBack();
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      dropPostelDetail(queryClient, postel.id);
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-4">
      <PostelView
        postel={postel}
        canEdit={canEdit}
        busy={remove.isPending || deleting}
        onBack={() => void onBack()}
        onEdit={onEdit}
        onRemove={handleRemove}
      />
      <PostelHistory id={postel.id} />
    </div>
  );
}
