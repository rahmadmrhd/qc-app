import type { QrDeviationPart } from '@shared/qrcode';

const PART_LABEL: Record<QrDeviationPart, string> = {
  title: 'Title',
  subtitle: 'Subtitle',
  footer: 'Footer',
  logo: 'Logo',
  layout: 'Ukuran',
  style: 'Gaya',
};

/** Peringatan (tidak memblokir) bagian label yang menyimpang dari konfigurasi default asal. */
export function PresetDeviationBanner({
  presetName,
  deviations,
}: {
  presetName: string;
  deviations: readonly QrDeviationPart[];
}) {
  if (deviations.length === 0) return null;
  return (
    <div
      role="status"
      className="rounded-md border border-warning-text/35 bg-warning-text/10 p-3 text-sm text-warning-text"
    >
      Berbeda dari konfigurasi default "{presetName}":{' '}
      <span className="font-medium">{deviations.map((part) => PART_LABEL[part]).join(', ')}</span>.
      Konfigurasi tetap dapat disimpan; ini hanya pengingat.
    </div>
  );
}
