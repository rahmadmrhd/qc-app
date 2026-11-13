import { createFileRoute } from '@tanstack/react-router';
import { requirePermission } from '@/modules/auth/permissions';
import { PushStatusPage } from '@/modules/push/components/push-status-page';
import { pushStatusQueryOptions } from '@/modules/push/queries';

export const Route = createFileRoute('/_app/access/push')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  // Mulai mengambil status tanpa menahan navigasi; halaman menampilkan "memuat" bila belum tiba.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(pushStatusQueryOptions());
  },
  component: PushStatusPage,
});
