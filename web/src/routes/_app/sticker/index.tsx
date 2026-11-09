import type { StickerDto } from '@shared/contract';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { businessUnitOptionsQueryOptions } from '@/modules/access/queries';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import {
  type StickerSaveInput,
  type StickerSaveResult,
  stickerSaveFailure,
} from '@/modules/sticker/components/sticker-form-dialog';
import { StickersPage } from '@/modules/sticker/components/stickers-page';
import { stickerKeys } from '@/modules/sticker/keys';
import { isStaleSaveError } from '@/modules/sticker/lib/stale';
import {
  stickersQuery,
  stickerTypesQuery,
  useSaveSticker,
  useSetStickerStatus,
} from '@/modules/sticker/queries';

export const Route = createFileRoute('/_app/sticker/')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'sticker', 'view'),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(stickersQuery()),
      context.queryClient.ensureQueryData(stickerTypesQuery()),
      context.queryClient.ensureQueryData(businessUnitOptionsQueryOptions()),
    ]),
  component: StickersRoute,
});

function StickersRoute() {
  const me = useMe();
  const queryClient = useQueryClient();
  const { data: stickers } = useSuspenseQuery(stickersQuery());
  const { data: types } = useSuspenseQuery(stickerTypesQuery());
  const { data: businessUnits } = useSuspenseQuery(businessUnitOptionsQueryOptions());
  const save = useSaveSticker();
  const setStatus = useSetStickerStatus();

  async function handleSave(input: StickerSaveInput): Promise<StickerSaveResult> {
    try {
      await save.mutateAsync(input);
      toast.success(input.id ? 'Stiker diperbarui' : 'Stiker ditambahkan');
      return null;
    } catch (error) {
      // Versi usang: muat ulang daftar agar tabel (dan form yang dibuka ulang) memakai data terbaru.
      if (isStaleSaveError(error))
        void queryClient.invalidateQueries({ queryKey: stickerKeys.all });
      return stickerSaveFailure(error);
    }
  }

  function toggleStatus(sticker: StickerDto) {
    const status = sticker.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: sticker.id, status },
      {
        onSuccess: () =>
          toast.success(status === 'active' ? 'Stiker diaktifkan' : 'Stiker dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  return (
    <StickersPage
      stickers={stickers}
      types={types}
      businessUnits={businessUnits}
      canEdit={can(me, 'sticker', 'edit')}
      canManage={can(me, 'sticker', 'manage')}
      pendingStatusId={setStatus.isPending ? (setStatus.variables?.id ?? null) : null}
      onSave={handleSave}
      onToggleStatus={toggleStatus}
    />
  );
}
