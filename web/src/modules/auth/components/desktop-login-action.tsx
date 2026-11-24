import type { AuthErrorCode, QcBridge } from '@countrylock/bridge-contract';
import type { MeDto } from '@shared/contract';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMeState as defaultLoadMeState, type MeState } from '@/app/boot';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export interface DesktopLoginActionProps {
  bridge: QcBridge;
  /** Memuat ulang `me` setelah login; bawaan `GET /api/v1/me` lewat proksi proses utama. */
  loadMeState?: () => Promise<MeState>;
  onSignedIn?: (me: MeDto) => void;
}

type Phase = 'idle' | 'waiting' | 'checking';

/** Batas tunggu login di browser sebelum UI menyerah (kode login berlaku 2 menit; ini jaring pengaman). */
export const LOGIN_WAIT_TIMEOUT_MS = 10 * 60 * 1000;

/** Batas memeriksa sesi (`me`) setelah login; server yang menggantung tak boleh membuat UI menunggu selamanya. */
export const LOGIN_CHECK_TIMEOUT_MS = 30 * 1000;

const LOGIN_FAILED_MESSAGE = 'Login belum berhasil. Coba lagi.';

/**
 * Pesan menurut penolakan login dari server (`AuthStatus.error`, jembatan v11). Teks selalu dari tabel ini: kode
 * dari jembatan hanya kunci pencarian. Kode tak dikenal atau jembatan lama (field `undefined`) = pesan umum.
 */
export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  NOT_WHITELISTED:
    'Akun Google ini belum terdaftar di QC App. Minta admin mendaftarkan emailmu dulu, lalu coba masuk lagi.',
  LOGIN_FAILED: 'Login Google gagal. Coba masuk lagi.',
};

function messageForError(code: unknown): string {
  return typeof code === 'string' && Object.hasOwn(AUTH_ERROR_MESSAGES, code)
    ? AUTH_ERROR_MESSAGES[code as AuthErrorCode]
    : LOGIN_FAILED_MESSAGE;
}

/**
 * Tombol login di aplikasi desktop: `bridge.auth.login()` membuka browser sistem (bukan tautan
 * `/auth/login`); hasilnya datang lewat `bridge.auth.onChange`. Saat `signedIn`, `me` dimuat ulang
 * dan pemanggil (rute login) memasukkan pengguna ke aplikasi. Token tidak pernah sampai ke sini.
 */
export function DesktopLoginAction({
  bridge,
  loadMeState = defaultLoadMeState,
  onSignedIn,
}: DesktopLoginActionProps) {
  const [phase, setPhaseState] = useState<Phase>('idle');
  // Pendengar `onChange` stabil, jadi fase terkini dibaca lewat ref (selalu diperbarui bersama state).
  const phaseRef = useRef<Phase>('idle');
  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);
  const [error, setError] = useState<string | null>(null);
  // Pendengar dipasang sekali; versi terbaru callback dibaca lewat ref agar tak perlu berlangganan ulang.
  const latest = useRef({ loadMeState, onSignedIn });
  latest.current = { loadMeState, onSignedIn };

  useEffect(() => {
    let alive = true;
    const off = bridge.auth.onChange((status) => {
      if (!status.signedIn) {
        // Penukaran kode gagal atau state kedaluwarsa memancarkan signedIn:false: jangan menggantung.
        if (phaseRef.current === 'waiting') {
          setPhase('idle');
          setError(messageForError(status.error));
        }
        return;
      }
      setPhase('checking');
      void (async () => {
        const { me, unreachable } = await latest.current.loadMeState();
        // Jawaban terlambat (setelah batas waktu memeriksa) diabaikan.
        if (!alive || phaseRef.current !== 'checking') return;
        if (me) {
          latest.current.onSignedIn?.(me);
          return;
        }
        setPhase('idle');
        setError(
          unreachable
            ? 'Tidak dapat terhubung ke server. Periksa koneksi lalu coba lagi.'
            : 'Login belum berhasil. Silakan coba lagi.',
        );
      })();
    });
    return () => {
      alive = false;
      off();
    };
  }, [bridge, setPhase]);

  // Menunggu tanpa kabar (callback hilang, aplikasi ditutup-buka): menyerah setelah batas waktu.
  useEffect(() => {
    if (phase !== 'waiting') return;
    const timer = setTimeout(() => {
      if (phaseRef.current !== 'waiting') return;
      setPhase('idle');
      setError(LOGIN_FAILED_MESSAGE);
    }, LOGIN_WAIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase, setPhase]);

  // Memeriksa sesi tanpa kabar: menyerah setelah batas waktu (pesan yang sama dengan login gagal).
  useEffect(() => {
    if (phase !== 'checking') return;
    const timer = setTimeout(() => {
      if (phaseRef.current !== 'checking') return;
      setPhase('idle');
      setError(LOGIN_FAILED_MESSAGE);
    }, LOGIN_CHECK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase, setPhase]);

  async function start() {
    setError(null);
    try {
      await bridge.auth.login();
      setPhase('waiting');
    } catch {
      setPhase('idle');
      setError('Tidak dapat membuka browser untuk login. Silakan coba lagi.');
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <Alert color="destructive" icon={false}>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        type="button"
        className="w-full"
        disabled={phase === 'checking'}
        onClick={() => void start()}
      >
        Masuk dengan Google
      </Button>
      {phase === 'waiting' ? (
        <p className="text-center text-sm text-muted-foreground" role="status">
          Lanjutkan login di browser…
        </p>
      ) : null}
      {phase === 'checking' ? (
        <p className="text-center text-sm text-muted-foreground" role="status">
          Memeriksa sesi…
        </p>
      ) : null}
    </div>
  );
}
