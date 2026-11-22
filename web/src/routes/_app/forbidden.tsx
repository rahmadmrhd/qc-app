import { createFileRoute } from '@tanstack/react-router';
import { StatusMessage } from '@/app/shell/status-message';
import { PageContent } from '@/components/page/page-container';

export const Route = createFileRoute('/_app/forbidden')({
  staticData: { crumb: 'Akses ditolak' },
  component: () => (
    <PageContent>
      <StatusMessage
        code="403"
        title="Akses ditolak"
        description="Anda tidak memiliki akses ke halaman ini."
      />
    </PageContent>
  ),
});
