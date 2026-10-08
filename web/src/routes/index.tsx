import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: () => <main className="p-6 text-2xl font-semibold">QC App</main>,
});
