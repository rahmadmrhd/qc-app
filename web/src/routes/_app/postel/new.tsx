import { createFileRoute } from '@tanstack/react-router';
import { requirePermission } from '@/modules/auth/permissions';

// Sementara: form Postel dibangun di Task 10 (rute ini diganti di sana).
export const Route = createFileRoute('/_app/postel/new')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'sticker', 'edit'),
  component: () => <p className="text-sm text-muted-foreground">Form Postel belum tersedia.</p>,
});
