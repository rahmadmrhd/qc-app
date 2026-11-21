import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requireAnyPermission } from '@/modules/auth/permissions';
import { HandoverBoardPage } from '@/modules/handover/components/handover-board-page';
import {
  handoverSearchSchema,
  searchFromStatus,
  statusFromSearch,
} from '@/modules/handover/lib/search';

export const Route = createFileRoute('/_app/handover/')({
  staticData: { pageWidth: 'full', locationAware: true },
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
  const { loc, customer, deleted } = search;
  return (
    <HandoverBoardPage
      status={status}
      locationId={loc}
      customerId={customer}
      deleted={deleted === true}
      // Filter (status, customer, tampilan) mengganti entri riwayat, tidak menambahnya.
      onClearCustomer={() =>
        void navigate({
          to: '/handover',
          search: searchFromStatus(status, loc, undefined, deleted),
          replace: true,
        })
      }
      onDeletedChange={(next) =>
        void navigate({
          to: '/handover',
          search: searchFromStatus(status, loc, customer, next),
          replace: true,
        })
      }
      onStatusChange={(next) =>
        void navigate({
          to: '/handover',
          search: searchFromStatus(next, loc, customer, deleted),
          replace: true,
        })
      }
      onOpen={(handoverId) =>
        stack.push({
          to: '/handover/$handoverId',
          params: { handoverId },
          search: searchFromStatus(status, loc, customer, deleted),
        })
      }
      onEdit={(handoverId) =>
        stack.push({
          to: '/handover/$handoverId/edit',
          params: { handoverId },
          search: searchFromStatus(status, loc, customer, deleted),
        })
      }
      onCreate={() => stack.push({ to: '/handover/new' })}
    />
  );
}
