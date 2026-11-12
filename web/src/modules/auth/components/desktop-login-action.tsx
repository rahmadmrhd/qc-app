import type { QcBridge } from '@countrylock/bridge-contract';
import type { MeDto } from '@shared/contract';
import { useEffect, useRef, useState } from 'react';
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
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  // Pendengar dipasang sekali; versi terbaru callback dibaca lewat ref agar tak perlu berlangganan ulang.
  const latest = useRef({ loadMeState, onSignedIn });
  latest.current = { loadMeState, onSignedIn };

  useEffect(() => {
    let alive = true;
    const off = bridge.auth.onChange((status) => {
      if (!status.signedIn) return;
      setPhase('checking');
      void (async () => {
        const { me, unreachable } = await latest.current.loadMeState();
        if (!alive) return;
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
  }, [bridge]);

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
        <Alert variant="destructive">
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
