import { createFileRoute } from '@tanstack/react-router';
import { requireAnyPermission } from '@/modules/auth/permissions';

export const Route = createFileRoute('/_app/serial/reports')({
  beforeLoad: ({ context }) =>
    requireAnyPermission(context.queryClient, [
      { module: 'serial', level: 'view' },
      { module: 'serialservice', level: 'view' },
    ]),
  component: () => null,
});
