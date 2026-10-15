import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/handover/$handoverId/')({
  component: () => <p>Detail task…</p>,
});
