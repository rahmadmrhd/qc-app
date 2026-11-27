import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requirePermission, warehouseCancelTarget } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { DispatchPage } from '@/modules/serialwh/components/dispatch-page';

const searchSchema = z.object({
  /** Task Serah Terima asal: form dibuka dari detail task. */
  handover: z.string().max(100).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/serial/gudang/')({
  staticData: { pageWidth: 'full', crumb: () => ({ label: 'Catat Serial WH' }) },
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'serialwh', 'edit'),
  component: DispatchRoute,
});

function DispatchRoute() {
  const search = Route.useSearch();
  const stack = useStackNavigation();
  const me = useMe();
  const fallback = warehouseCancelTarget(me);
  return (
    <DispatchPage
      {...(search.handover ? { handoverId: search.handover } : {})}
      onCancel={() => stack.pop({ to: fallback })}
    />
  );
}
