import { Camera } from 'lucide-react';
import { useState } from 'react';
import type { FileDialogCameraApi } from '@/components/file-dialog';
import { Button } from '@/components/ui/button';
import { CAMERA_ERROR_TEXT } from '../lib/use-camera-scanner';
import { usePhotoCamera } from '../lib/use-photo-camera';

/**
 * Isi tab "Kamera" di file dialog foto bukti: pratinjau langsung dan tombol "Ambil foto" (boleh berturut-turut; tiap
 * foto masuk antrean unggah, tab tidak berpindah). Kamera hanya menyala selama tab ini tampil. Bila kamera tak ada
 * atau izinnya ditolak, pesan jelas tampil dan tab Unggah (Telusuri) tetap bisa dipakai.
 */
export function ProofCameraTab({ active, disabled, queued, max, addFile }: FileDialogCameraApi) {
  const camera = usePhotoCamera({ enabled: active });
  const [failed, setFailed] = useState(false);
  const { state } = camera;
  const full = queued >= max;

  async function shoot() {
    const file = await camera.capture();
    if (file === null) {
      setFailed(true);
      return;
    }
    setFailed(false);
    addFile(file);
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative aspect-[4/3] w-full max-w-lg overflow-hidden rounded-md bg-black">
        <video
          ref={camera.videoRef}
          aria-label="Pratinjau kamera"
          className="absolute inset-0 size-full object-contain"
          playsInline
          muted
        />
        {state.status === 'loading' ? (
          <p
            role="status"
            className="absolute inset-0 flex items-center justify-center bg-black/60 p-4 text-center text-sm text-white"
          >
            Menyiapkan kamera…
          </p>
        ) : null}
        {state.status === 'error' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-4 text-center text-sm text-white">
            <p role="alert">{CAMERA_ERROR_TEXT[state.kind]}</p>
            {state.kind !== 'insecure' && state.kind !== 'unsupported' ? (
              <Button type="button" variant="secondary" size="sm" onClick={camera.retry}>
                Coba lagi
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <Button
        type="button"
        disabled={disabled || full || state.status !== 'scanning'}
        onClick={() => void shoot()}
      >
        <Camera aria-hidden />
        Ambil foto
      </Button>
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {failed
          ? 'Foto belum berhasil diambil. Coba jepret lagi.'
          : full
            ? `Batas ${max} foto tercapai. Tekan Tambahkan untuk menyimpannya.`
            : state.status === 'error'
              ? 'Kamera tidak bisa dipakai. Buka tab Unggah dan tekan Telusuri untuk memilih foto dari perangkat.'
              : `${queued} foto siap ditambahkan (maks. ${max}).`}
      </p>
    </div>
  );
}
