import type { AuthStatus } from '@countrylock/bridge-contract';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { createFakeBridge } from '@/modules/countrylock/fake-bridge';
import { DesktopLoginAction, LOGIN_WAIT_TIMEOUT_MS } from './desktop-login-action';

afterEach(() => vi.useRealTimers());

const SIGNED_OUT: AuthStatus = { signedIn: false, email: null, serverUrl: 'https://qc.rhd.my.id' };

function setup() {
  const emitter: { emit: (s: AuthStatus) => void } = { emit: () => undefined };
  const bridge = createFakeBridge({
    auth: {
      onChange: (cb) => {
        emitter.emit = cb;
        return () => undefined;
      },
    },
  });
  render(<DesktopLoginAction bridge={bridge} />);
  return emitter;
}

const loginButton = () => screen.getByRole('button', { name: 'Masuk dengan Google' });

test('login gagal (signedIn: false saat menunggu) kembali ke idle dengan pesan, tidak menggantung', async () => {
  const emitter = setup();
  await userEvent.click(loginButton());
  expect(await screen.findByText(/lanjutkan login di browser/i)).toBeInTheDocument();

  act(() => emitter.emit(SIGNED_OUT));
  expect(await screen.findByText('Login belum berhasil. Coba lagi.')).toBeInTheDocument();
  expect(screen.queryByText(/lanjutkan login di browser/i)).not.toBeInTheDocument();
  expect(loginButton()).toBeEnabled();
});

test('signedIn: false di luar fase menunggu (mis. logout) diabaikan tanpa pesan', () => {
  const emitter = setup();
  act(() => emitter.emit(SIGNED_OUT));
  expect(screen.queryByText(/login belum berhasil/i)).not.toBeInTheDocument();
});

test('batas waktu tunggu 10 menit: kembali ke idle dengan pesan yang sama', async () => {
  expect(LOGIN_WAIT_TIMEOUT_MS).toBe(10 * 60 * 1000);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setup();
  await userEvent.click(loginButton());
  expect(await screen.findByText(/lanjutkan login di browser/i)).toBeInTheDocument();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOGIN_WAIT_TIMEOUT_MS - 1000);
  });
  expect(screen.getByText(/lanjutkan login di browser/i)).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(screen.getByText('Login belum berhasil. Coba lagi.')).toBeInTheDocument();
  expect(screen.queryByText(/lanjutkan login di browser/i)).not.toBeInTheDocument();
});
