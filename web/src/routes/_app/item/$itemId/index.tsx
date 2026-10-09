import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/item/$itemId/')({
  component: () => null,
});
