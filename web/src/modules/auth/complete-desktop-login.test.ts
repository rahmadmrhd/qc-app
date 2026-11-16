import type { MeDto } from '@shared/contract';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, expect, test, vi } from 'vitest';
import { completeDesktopLogin } from './complete-desktop-login';
import { ANONYMOUS_SESSION, getSession, initSession } from './session';

afterEach(() => initSession(ANONYMOUS_SESSION));

test('login desktop selesai: sesi sah, me masuk cache, dan masuk ke beranda', async () => {
  initSession({ ...ANONYMOUS_SESSION, serverUnreachable: true, authError: 'LOGIN_FAILED' });
  const queryClient = new QueryClient();
  const navigate = vi.fn(async () => undefined);
  const me = { email: 'a@x.com', name: 'A' } as MeDto;

  await completeDesktopLogin(me, { queryClient, navigate });

  expect(getSession()).toMatchObject({
    authenticated: true,
    email: 'a@x.com',
    authError: null,
    serverUnreachable: false,
  });
  expect(queryClient.getQueryData(['auth', 'me'])).toEqual(me);
  expect(navigate).toHaveBeenCalledWith({ to: '/' });
});
