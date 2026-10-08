import type { QueryClient } from '@tanstack/react-query';
import { createHashHistory, createRouter } from '@tanstack/react-router';
import { routeTree } from '@/routeTree.gen';

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    history: createHashHistory(),
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
