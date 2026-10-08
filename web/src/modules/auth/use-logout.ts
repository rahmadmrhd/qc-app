import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { clearToken } from './session';

export function useLogout(): () => void {
  const router = useRouter();
  const queryClient = useQueryClient();
  return () => {
    clearToken();
    queryClient.clear();
    void router.navigate({ to: '/login' });
  };
}
