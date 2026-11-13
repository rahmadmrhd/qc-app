import { createFileRoute } from '@tanstack/react-router';
import { requirePermission } from '@/modules/auth/permissions';

export const Route = createFileRoute('/_app/serial/report')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'serial', 'edit'),
  component: () => null,
});
