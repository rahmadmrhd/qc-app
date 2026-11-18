/**
 * Pratinjau cap foto bukti di kamera (spek 2026-11-18 §3 G, bentuk cap resmi: spek bukti foto §5.3). Hanya tampilan:
 * cap resmi digambar server saat Simpan dengan jam server dan tidak pernah berasal dari klien.
 */
export interface StampPreviewInput {
  serial: string;
  /** "Merk Tipe" item. */
  itemLabel: string;
  /** Kode BU (sama dengan yang dipakai cap server). */
  buLabel: string;
  locationLabel: string;
  actorName: string;
  /** Label tim ("QC"). */
  actorTeam: string;
}

/** Pemisah baris 3 dan 4; karakter yang sama dengan cap server (`proof/font.ts`). */
const MIDDLE_DOT = '·';

/** Empat baris cap persis spek: `SN: …`, item, `BU · Lokasi`, `Disimpan saat Simpan · Pelaku (Tim)`. */
export function stampPreviewLines(input: StampPreviewInput): string[] {
  const place = [input.buLabel, input.locationLabel]
    .filter((part) => part !== '')
    .join(` ${MIDDLE_DOT} `);
  return [
    `SN: ${input.serial}`,
    input.itemLabel,
    place,
    `Disimpan saat Simpan ${MIDDLE_DOT} ${input.actorName} (${input.actorTeam})`,
  ];
}
