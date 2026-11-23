import type { ReactNode } from 'react';

/** Satu butir legenda: swatch warna + label TEKS (warna saja tidak cukup untuk dibedakan). */
export interface LegendItem {
  key: string;
  label: string;
  color: string;
  /** Nilai ringkas di samping label (opsional). */
  value?: string | number;
}

/** Pesan bila tidak ada data untuk digambar (menggantikan grafik kosong). */
export function EmptyChart() {
  return (
    <p role="status" className="py-10 text-center text-sm text-muted-foreground">
      Belum ada data
    </p>
  );
}

/**
 * Rangka bersama semua grafik: visual `role="img"` ber-`aria-label`, tabel `sr-only` berisi SEMUA nilai (pembaca
 * layar tak dapat membaca isi `role="img"`), dan legenda berlabel teks.
 */
export function ChartFrame({
  label,
  legend,
  head,
  rows,
  children,
}: {
  label: string;
  legend?: readonly LegendItem[];
  head: readonly string[];
  rows: readonly (readonly (string | number)[])[];
  children: ReactNode;
}) {
  return (
    <div data-slot="chart-frame" className="flex flex-col gap-2">
      <div role="img" aria-label={label}>
        {children}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: baris tabel statis dan boleh kembar (label dan nilai sama), urutan tetap
            <tr key={rowIndex}>
              {row.map((cell, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: sel tabel statis, urutan tetap
                <td key={index}>{String(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {legend && legend.length > 0 ? (
        <ul aria-label={`Legenda ${label}`} className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {legend.map((item) => (
            <li key={item.key} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: item.color }}
              />
              <span>{item.label}</span>
              {item.value === undefined ? null : (
                <span className="text-muted-foreground">{item.value}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Gaya sumbu seragam (font >= 12 px, warna teks sekunder dari token). */
export const AXIS_TICK = { fontSize: 12, fill: 'var(--muted-foreground)' } as const;
