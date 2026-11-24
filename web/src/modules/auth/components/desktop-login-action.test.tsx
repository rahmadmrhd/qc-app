import type { AuthStatus } from '@countrylock/bridge-contract';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { createFakeBridge } from '@/modules/countrylock/fake-bridge';
import {
  AUTH_ERROR_MESSAGES,
  DesktopLoginAction,
  LOGIN_CHECK_TIMEOUT_MS,
  LOGIN_WAIT_TIMEOUT_MS,
} from './desktop-login-action';

afterEach(() => vi.useRealTimers());

const SIGNED_OUT: AuthStatus = { signedIn: false, email: null, serverUrl: 'https://qc.rhd.my.id' };

function setup(loadMeState?: () => Promise<{ me: null; unreachable: boolean }>) {
  const emitter: { emit: (s: AuthStatus) => void } = { emit: () => undefined };
  const bridge = createFakeBridge({
    auth: {
      onChange: (cb) => {
        emitter.emit = cb;
        return () => undefined;
      },
    },
  });
  render(<DesktopLoginAction bridge={bridge} loadMeState={loadMeState} />);
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

test('login ditolak server NOT_WHITELISTED: pesan akun belum terdaftar + minta admin, bukan pesan umum', async () => {
  const emitter = setup();
  await userEvent.click(loginButton());
  await screen.findByText(/lanjutkan login di browser/i);

  act(() => emitter.emit({ ...SIGNED_OUT, error: 'NOT_WHITELISTED' }));
  expect(await screen.findByText(AUTH_ERROR_MESSAGES.NOT_WHITELISTED)).toBeInTheDocument();
  expect(screen.getByText(/belum terdaftar/i)).toBeInTheDocument();
  expect(screen.getByText(/minta admin/i)).toBeInTheDocument();
  expect(screen.queryByText('Login belum berhasil. Coba lagi.')).not.toBeInTheDocument();
  expect(screen.queryByText(/lanjutkan login di browser/i)).not.toBeInTheDocument();
  expect(loginButton()).toBeEnabled();
});

test('login ditolak server LOGIN_FAILED: pesan login gagal yang khusus', async () => {
  const emitter = setup();
  await userEvent.click(loginButton());
  await screen.findByText(/lanjutkan login di browser/i);

  act(() => emitter.emit({ ...SIGNED_OUT, error: 'LOGIN_FAILED' }));
  expect(await screen.findByText(AUTH_ERROR_MESSAGES.LOGIN_FAILED)).toBeInTheDocument();
  expect(screen.queryByText(/belum terdaftar/i)).not.toBeInTheDocument();
});

test('kode galat tak dikenal (jembatan lain) jatuh ke pesan umum; teks tak pernah dari kode', async () => {
  const emitter = setup();
  await userEvent.click(loginButton());
  await screen.findByText(/lanjutkan login di browser/i);

  act(() => emitter.emit({ ...SIGNED_OUT, error: '<b>APA_SAJA</b>' as never }));
  expect(await screen.findByText('Login belum berhasil. Coba lagi.')).toBeInTheDocument();
  expect(screen.queryByText(/APA_SAJA/)).not.toBeInTheDocument();
});

test('pesan penolakan hilang saat mencoba masuk lagi', async () => {
  const emitter = setup();
  await userEvent.click(loginButton());
  await screen.findByText(/lanjutkan login di browser/i);
  act(() => emitter.emit({ ...SIGNED_OUT, error: 'NOT_WHITELISTED' }));
  await screen.findByText(AUTH_ERROR_MESSAGES.NOT_WHITELISTED);

  await userEvent.click(loginButton());
  expect(screen.queryByText(AUTH_ERROR_MESSAGES.NOT_WHITELISTED)).not.toBeInTheDocument();
  expect(await screen.findByText(/lanjutkan login di browser/i)).toBeInTheDocument();
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

test('N2: memeriksa sesi yang menggantung menyerah setelah batas waktu; jawaban terlambat diabaikan', async () => {
  expect(LOGIN_CHECK_TIMEOUT_MS).toBe(30_000);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const onSignedIn = vi.fn();
  let resolveMe: (v: { me: null; unreachable: boolean }) => void = () => undefined;
  const emitter: { emit: (s: AuthStatus) => void } = { emit: () => undefined };
  const bridge = createFakeBridge({
    auth: {
      onChange: (cb) => {
        emitter.emit = cb;
        return () => undefined;
      },
    },
  });
  render(
    <DesktopLoginAction
      bridge={bridge}
      onSignedIn={onSignedIn}
      loadMeState={() =>
        new Promise((resolve) => {
          resolveMe = resolve;
        })
      }
    />,
  );
  await userEvent.click(loginButton());
  act(() => emitter.emit({ ...SIGNED_OUT, signedIn: true, email: 'a@x.com' }));
  expect(await screen.findByText(/memeriksa sesi/i)).toBeInTheDocument();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOGIN_CHECK_TIMEOUT_MS + 500);
  });
  expect(screen.getByText('Login belum berhasil. Coba lagi.')).toBeInTheDocument();
  expect(loginButton()).toBeEnabled();

  // Jawaban yang tiba terlambat tidak mengubah apa pun.
  await act(async () => resolveMe({ me: null, unreachable: false }));
  expect(onSignedIn).not.toHaveBeenCalled();
  expect(screen.getByText('Login belum berhasil. Coba lagi.')).toBeInTheDocument();
});
