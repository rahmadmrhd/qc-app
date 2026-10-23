import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { requireAnyPermission } from '@/modules/auth/permissions';
import { HandoverBoardPage } from '@/modules/handover/components/handover-board-page';

export const Route = createFileRoute('/_app/handover/')({
  beforeLoad: ({ context }) =>
    requireAnyPermission(context.queryClient, [
      { module: 'handover', level: 'view' },
      { module: 'qc', level: 'edit' },
    ]),
  component: HandoversPage,
});

function HandoversPage() {
  const navigate = useNavigate();
  return (
    <HandoverBoardPage
      onOpen={(handoverId) =>
        void navigate({ to: '/handover/$handoverId', params: { handoverId } })
      }
      onEdit={(handoverId) =>
        void navigate({ to: '/handover/$handoverId/edit', params: { handoverId } })
      }
      onCreate={() => void navigate({ to: '/handover/new' })}
    />
  );
}
