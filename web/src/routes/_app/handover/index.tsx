import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { requireAnyPermission } from '@/modules/auth/permissions';
import { HandoverBoardPage } from '@/modules/handover/components/handover-board-page';
import {
  handoverSearchSchema,
  searchFromStatus,
  statusFromSearch,
} from '@/modules/handover/lib/search';

export const Route = createFileRoute('/_app/handover/')({
  staticData: { pageWidth: 'full' },
  validateSearch: (search: Record<string, unknown>) => handoverSearchSchema.parse(search),
  beforeLoad: ({ context }) =>
    requireAnyPermission(context.queryClient, [
      { module: 'handover', level: 'view' },
      { module: 'qc', level: 'edit' },
    ]),
  component: HandoversPage,
});

function HandoversPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const status = statusFromSearch(search);
  const { loc } = search;
  return (
    <HandoverBoardPage
      status={status}
      locationId={loc}
      onStatusChange={(next) =>
        void navigate({ to: '/handover', search: searchFromStatus(next, loc), replace: true })
      }
      onOpen={(handoverId) =>
        void navigate({
          to: '/handover/$handoverId',
          params: { handoverId },
          search: searchFromStatus(status, loc),
        })
      }
      onEdit={(handoverId) =>
        void navigate({
          to: '/handover/$handoverId/edit',
          params: { handoverId },
          search: searchFromStatus(status, loc),
        })
      }
      onCreate={() => void navigate({ to: '/handover/new' })}
    />
  );
}
