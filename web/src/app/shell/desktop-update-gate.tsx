import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getAppBridge, useDesktopBlock } from './use-desktop-block';

type Phase =
  | { step: 'idle' }
  | { step: 'running' }
  | { step: 'restarting' }
  | { step: 'result'; message: string };

const RESTARTING_TEXT = 'Memasang pembaruan, aplikasi akan mulai ulang...';

/**
 * Penahan layar penuh untuk aplikasi desktop yang terlalu lama bagi server (fase 3 versi API): bila `blocked`, `children`
 * TIDAK dirender sama sekali dan yang tampil hanya layar "Perlu pembaruan". Sengaja menggantikan seluruh isi layout
 * (sidebar dan header ikut hilang) supaya tak ada jalan memanggil API yang pasti ditolak. Country Lock tetap bisa
 * dibuka lewat tautan di layar ini: rutenya di luar layout `_app` sehingga tak ikut tertahan. Tanpa tombol "Nanti":
 * pembaruan di sini bukan pilihan, melainkan syarat supaya aplikasi bisa dipakai lagi.
 */
export function DesktopUpdateGate({ children }: { children: ReactNode }) {
  const { blocked } = useDesktopBlock();
  if (!blocked) return <>{children}</>;
  return <UpdateRequiredScreen />;
}

function UpdateRequiredScreen() {
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function update() {
    const bridge = getAppBridge();
    if (bridge === null) return;
    setPhase({ step: 'running' });
    setDownloadError(null);
    try {
      const result = await bridge.app.update();
      setPhase(
        result.status === 'restarting'
          ? { step: 'restarting' }
          : { step: 'result', message: result.message },
      );
    } catch {
      setPhase({ step: 'result', message: 'Pembaruan gagal dijalankan.' });
    }
  }

  async function openDownloads() {
    setDownloadError(null);
    try {
      await getAppBridge()?.app.openDownloads();
    } catch {
      setDownloadError('Halaman unduhan gagal dibuka.');
    }
  }

  const running = phase.step === 'running';
  const restarting = phase.step === 'restarting';
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-lg font-semibold">Perlu pembaruan</h1>
        <p className="text-sm text-muted-foreground">
          Versi aplikasi ini sudah terlalu lama untuk server. Perbarui dulu supaya semua fitur jalan
          lagi. Country Lock tetap bisa dipakai.
        </p>
        {restarting && (
          <p role="status" className="text-sm">
            {RESTARTING_TEXT}
          </p>
        )}
        {phase.step === 'result' && (
          <p role="status" className="text-sm">
            {phase.message}
          </p>
        )}
        <div className="flex flex-col items-center gap-2">
          <Button onClick={() => void update()} disabled={running || restarting}>
            Perbarui sekarang
          </Button>
          {phase.step === 'result' && (
            <Button variant="link" size="sm" onClick={() => void openDownloads()}>
              Unduh manual
            </Button>
          )}
          {downloadError !== null && (
            <p role="alert" className="text-sm text-destructive">
              {downloadError}
            </p>
          )}
          <Link to="/country-lock" className="text-sm underline underline-offset-4">
            Buka Country Lock
          </Link>
        </div>
      </div>
    </main>
  );
}
