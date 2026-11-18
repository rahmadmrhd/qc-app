import { Eye, EyeOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type StampPreviewInput, stampPreviewLines } from '../lib/stamp-preview';

/**
 * Pratinjau cap di atas pandangan kamera: empat baris di kotak hitam berhuruf putih (mirip footer cap resmi) dan
 * keterangan bahwa cap resmi ditambahkan server. Hanya overlay HTML: bukan bagian dari gambar yang dipotret. Satu
 * tombol menyembunyikannya. Diletakkan di atas baris kontrol kiri dan di kiri kolom zoom.
 */
export function StampPreview({ input }: { input: StampPreviewInput }) {
  const [visible, setVisible] = useState(true);
  const lines = useMemo(() => stampPreviewLines(input), [input]);
  return (
    <div
      data-testid="stamp-preview"
      data-camera-control
      className="absolute right-[4.75rem] bottom-[4.5rem] left-3 flex flex-col items-start gap-1"
    >
      <button
        type="button"
        aria-pressed={!visible}
        aria-label={visible ? 'Sembunyikan pratinjau cap' : 'Tampilkan pratinjau cap'}
        title={visible ? 'Sembunyikan pratinjau cap' : 'Tampilkan pratinjau cap'}
        className="flex size-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
        onClick={(event) => {
          event.stopPropagation();
          setVisible((value) => !value);
        }}
      >
        {visible ? (
          <EyeOff aria-hidden className="size-4" />
        ) : (
          <Eye aria-hidden className="size-4" />
        )}
      </button>
      {visible ? (
        <div
          role="note"
          aria-label="Pratinjau cap"
          className="w-full rounded-md bg-black/80 px-2 py-1.5 font-mono text-[11px] leading-snug text-white"
        >
          {lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: empat baris tetap, urutan = isi
            <p key={index} className="truncate" title={line}>
              {line}
            </p>
          ))}
          <p className="mt-1 text-[10px] text-white/70">
            Pratinjau: cap resmi ditambahkan server saat Simpan.
          </p>
        </div>
      ) : null}
    </div>
  );
}
