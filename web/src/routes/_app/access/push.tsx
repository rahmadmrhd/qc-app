import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { usersQueryOptions } from '@/modules/access/queries';
import { requirePermission } from '@/modules/auth/permissions';
import { PushStatusPage } from '@/modules/push/components/push-status-page';
import { pushStatusQueryOptions } from '@/modules/push/queries';

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/access/push')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  // Mulai mengambil status dan daftar pengguna (untuk tautan nama ke View) tanpa menahan navigasi; halaman
  // menampilkan "memuat" bila belum tiba.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(pushStatusQueryOptions());
    void context.queryClient.prefetchQuery(usersQueryOptions());
  },
  component: PushStatusRoute,
});

function PushStatusRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [text, setText] = useUrlSyncedText(
    search.q ?? '',
    (value) =>
      void navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  );
  return <PushStatusPage text={text} onTextChange={setText} />;
}
