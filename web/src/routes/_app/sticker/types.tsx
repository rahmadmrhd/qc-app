import type { StickerTypeDto } from '@shared/contract';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import {
  type StickerTypeSaveInput,
  type StickerTypeSaveResult,
  stickerTypeSaveFailure,
} from '@/modules/sticker/components/sticker-type-form-dialog';
import { StickerTypesPage } from '@/modules/sticker/components/sticker-types-page';
import { stickerKeys } from '@/modules/sticker/keys';
import { isStaleSaveError } from '@/modules/sticker/lib/stale';
import {
  stickerTypesQuery,
  useSaveStickerType,
  useSetStickerTypeStatus,
} from '@/modules/sticker/queries';

export const Route = createFileRoute('/_app/sticker/types')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'sticker', 'view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(stickerTypesQuery()),
  component: StickerTypesRoute,
});

function StickerTypesRoute() {
  const me = useMe();
  const queryClient = useQueryClient();
  const { data: types } = useSuspenseQuery(stickerTypesQuery());
  const save = useSaveStickerType();
  const setStatus = useSetStickerTypeStatus();

  async function handleSave(input: StickerTypeSaveInput): Promise<StickerTypeSaveResult> {
    try {
      await save.mutateAsync(input);
      toast.success(input.id ? 'Jenis stiker diperbarui' : 'Jenis stiker ditambahkan');
      return null;
    } catch (error) {
      // Versi usang: muat ulang daftar agar tabel (dan form yang dibuka ulang) memakai data terbaru.
      if (isStaleSaveError(error))
        void queryClient.invalidateQueries({ queryKey: stickerKeys.all });
      return stickerTypeSaveFailure(error);
    }
  }

  function toggleStatus(type: StickerTypeDto) {
    const status = type.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: type.id, status },
      {
        onSuccess: () =>
          toast.success(status === 'active' ? 'Jenis diaktifkan' : 'Jenis dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  return (
    <StickerTypesPage
      types={types}
      canEdit={can(me, 'sticker', 'edit')}
      canManage={can(me, 'sticker', 'manage')}
      pendingStatusId={setStatus.isPending ? (setStatus.variables?.id ?? null) : null}
      onSave={handleSave}
      onToggleStatus={toggleStatus}
    />
  );
}
