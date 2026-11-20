import { Eye, EyeOff } from 'lucide-react';
import { useMemo } from 'react';
import type { CameraStampSlot } from '@/components/file-dialog/camera/camera-dialog';
import { type StampPreviewInput, stampPreviewLines } from '../lib/stamp-preview';

/**
 * Pratinjau cap di atas pandangan kamera: empat baris di kotak hitam semi-transparan berhuruf putih (mirip footer cap
 * resmi) dan keterangan bahwa cap resmi ditambahkan server. Hanya overlay HTML: bukan bagian dari gambar yang
 * dipotret. Penataan letak (di atas strip foto dan rana) dan tombol sembunyikan (`StampToggleButton`) diatur
 * pemanggil, yang memegang keadaan tampil/sembunyi.
 */
export function StampNote({ input }: { input: StampPreviewInput }) {
  const lines = useMemo(() => stampPreviewLines(input), [input]);
  return (
    <div
      data-testid="stamp-preview"
      role="note"
      aria-label="Pratinjau cap"
      className="w-full rounded-md bg-black/65 px-2 py-1.5 font-mono text-[11px] leading-snug text-white backdrop-blur-[2px]"
    >
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: empat baris tetap, urutan = isi
        <p key={index} className="truncate" title={line}>
          {line}
        </p>
      ))}
      {/* Di layar pendek (ponsel landscape) keterangan ini dilipat agar pratinjau tak menutup subjek. */}
      <p className="mt-1 text-[10px] text-white/70 [@media(max-height:30rem)]:hidden">
        Pratinjau: cap resmi ditambahkan server saat Simpan.
      </p>
    </div>
  );
}

/** Tombol bulat 44 px untuk menyembunyikan/menampilkan pratinjau cap (gaya sama dengan kontrol kamera lain). */
export function StampToggleButton({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  const label = visible ? 'Sembunyikan pratinjau cap' : 'Tampilkan pratinjau cap';
  return (
    <button
      type="button"
      aria-pressed={!visible}
      aria-label={label}
      title={label}
      className="flex size-11 items-center justify-center rounded-full bg-black/50 text-white outline-none hover:bg-black/70 focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={onToggle}
    >
      {visible ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
    </button>
  );
}

/** Slot cap untuk `CameraDialog`: tombol sembunyikan dan pratinjau cap foto bukti QC. */
export function proofCameraStamp(input: StampPreviewInput): CameraStampSlot {
  return {
    renderToggle: (visible, onToggle) => (
      <StampToggleButton visible={visible} onToggle={onToggle} />
    ),
    renderNote: () => <StampNote input={input} />,
  };
}
