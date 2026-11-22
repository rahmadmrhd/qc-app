import { MonitorDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/api-error';
import { isAuthenticated } from '@/modules/auth/session';
import { openInDesktop } from '../lib/handoff';

/**
 * Tampilan Country Lock di peramban biasa: fitur ini butuh aplikasi desktop (akses jaringan lokal
 * dan SSH). Sudah login: tombol membuka aplikasi desktop dengan akun yang sama (serah-terima tiket; aplikasi yang
 * menanyakan bila akunnya berbeda). Belum login atau tanpa izin Country Lock: tautan `qc://country-lock` biasa.
 */
export function OpenInDesktop() {
  const signedIn = isAuthenticated();
  const [state, setState] = useState<'idle' | 'busy' | 'forbidden' | 'error'>('idle');

  async function handoff() {
    setState('busy');
    try {
      await openInDesktop();
      setState('idle');
    } catch (error) {
      setState(error instanceof ApiError && error.code === 'FORBIDDEN' ? 'forbidden' : 'error');
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center">
      <MonitorDown className="size-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-xl font-semibold">Country Lock hanya tersedia di aplikasi desktop</h1>
      <p className="text-sm text-muted-foreground">
        Country Lock perlu terhubung langsung ke perangkat di jaringan lokal Anda, sehingga tidak
        dapat berjalan di peramban.
      </p>
      {signedIn && state !== 'forbidden' ? (
        <Button type="button" onClick={() => void handoff()} disabled={state === 'busy'}>
          Buka di aplikasi desktop
        </Button>
      ) : (
        <Button asChild>
          <a href="qc://country-lock">Buka di aplikasi desktop</a>
        </Button>
      )}
      {signedIn && state === 'idle' && (
        <p className="text-xs text-muted-foreground">
          Aplikasi desktop akan masuk dengan akun yang sama. Bila akunnya berbeda, Anda akan ditanya
          dulu.
        </p>
      )}
      {state === 'forbidden' && (
        <p role="alert" className="text-sm text-destructive-text">
          Akun Anda belum punya izin Country Lock, jadi tidak dapat dibawa ke aplikasi desktop.
          Minta admin untuk memberi izinnya.
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="text-sm text-destructive-text">
          Gagal menyiapkan tautan ke aplikasi desktop. Coba lagi sebentar.
        </p>
      )}
      <p className="text-xs text-muted-foreground">Unduhan tersedia setelah rilis.</p>
    </div>
  );
}
