import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requireAnyPermission } from '@/modules/auth/permissions';
import { HandoverBoardPage } from '@/modules/handover/components/handover-board-page';
import {
  customersOfSearch,
  handoverSearchSchema,
  searchFromStatus,
  statusFromSearch,
} from '@/modules/handover/lib/search';

export const Route = createFileRoute('/_app/handover/')({
  staticData: { locationAware: true },
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
  const stack = useStackNavigation();
  const search = Route.useSearch();
  const status = statusFromSearch(search);
  const { loc, deleted } = search;
  const customers = customersOfSearch(search);
  return (
    <HandoverBoardPage
      status={status}
      locationId={loc}
      customerIds={customers}
      deleted={deleted === true}
      // Filter (status, customer, tampilan) mengganti entri riwayat, tidak menambahnya.
      onCustomersChange={(next) =>
        void navigate({
          to: '/handover',
          search: searchFromStatus(status, loc, next, deleted),
          replace: true,
        })
      }
      onDeletedChange={(next) =>
        void navigate({
          to: '/handover',
          search: searchFromStatus(status, loc, customers, next),
          replace: true,
        })
      }
      onStatusChange={(next) =>
        void navigate({
          to: '/handover',
          search: searchFromStatus(next, loc, customers, deleted),
          replace: true,
        })
      }
      onOpen={(handoverId) =>
        stack.push({
          to: '/handover/$handoverId',
          params: { handoverId },
          search: searchFromStatus(status, loc, customers, deleted),
        })
      }
      onEdit={(handoverId) =>
        stack.push({
          to: '/handover/$handoverId/edit',
          params: { handoverId },
          search: searchFromStatus(status, loc, customers, deleted),
        })
      }
      onCreate={() => stack.push({ to: '/handover/new' })}
    />
  );
}
