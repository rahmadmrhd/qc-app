import { Alert, AlertDescription } from '@/components/ui/alert';
import type { RowWarning, WarningCounts } from '../lib/warnings';

const TEXT: Record<RowWarning, (count: number) => string> = {
  test_date_diff: (count) =>
    `${count} serial punya tanggal uji yang berbeda dari kebanyakan pilihan.`,
  bu_diff: (count) => `${count} serial ada di BU yang berbeda dari BU catatan ini.`,
  prior_same_bu: (count) =>
    `${count} serial sebelumnya sudah keluar di BU ini (mungkin duplikat atau retur).`,
  prior_other_bu: (count) => `${count} serial sebelumnya keluar di BU lain.`,
};

const ORDER: RowWarning[] = ['test_date_diff', 'bu_diff', 'prior_same_bu', 'prior_other_bu'];

/** Daftar serial yang ditampilkan saat banner dibuka (sisanya diringkas). */
const LIST_MAX = 30;

/**
 * Banner ringkas di atas tabel: satu baris per jenis peringatan yang berlaku (info untuk "BU lain"). Dengan `serials`,
 * banner dapat dibuka untuk melihat serial yang terkena.
 */
export function WarningBanners({
  counts,
  serials,
}: {
  counts: WarningCounts;
  serials?: Record<RowWarning, readonly string[]>;
}) {
  const shown = ORDER.filter((kind) => counts[kind] > 0);
  if (shown.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="warehouse-warning-banners">
      {shown.map((kind) => (
        <Alert key={kind} color={kind === 'prior_other_bu' ? 'info' : 'warning'}>
          <AlertDescription>
            {serials && serials[kind].length > 0 ? (
              <details>
                <summary className="cursor-pointer">{TEXT[kind](counts[kind])}</summary>
                <p className="mt-1 font-mono text-xs break-words">
                  {serials[kind].slice(0, LIST_MAX).join(', ')}
                  {serials[kind].length > LIST_MAX
                    ? ` dan ${serials[kind].length - LIST_MAX} lainnya`
                    : ''}
                </p>
              </details>
            ) : (
              TEXT[kind](counts[kind])
            )}
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
