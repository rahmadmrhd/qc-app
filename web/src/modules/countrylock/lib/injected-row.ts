import { normalizeSerial, serialProblem } from '@shared/serials';
import type { StagingRow } from '@/modules/serial/lib/draft';
import { todayWib } from '@/modules/serial/lib/locations';

/** Bahan satu baris draft dari hasil inject: Tipe katalog (= Item Serial Number), BU, dan lokasi dari form inject. */
export interface InjectedRowInput {
  serial: string;
  itemId: string;
  itemLabel: string;
  buId: string;
  buLabel: string;
  locationId: string;
  locationLabel: string;
  /** Kunci idempoten baris; bawaan dibuat pemanggil (`ctx.clientId`). Mode Multi menurunkannya dari id peristiwa. */
  clientId?: string;
  /** Cap waktu inject (ISO) dari peristiwa Multi: tanggal uji WIB dan `capturedAt` dihitung darinya, bukan saat dicatat. */
  injectedAt?: string;
}

/**
 * Baris draft untuk serial yang baru di-inject (`source: 'countrylock'`, serial terkunci di tabel). Serial dinormalisasi
 * seperti di web (MAC `aa:bb:..` menjadi heksadesimal polos). Serial tak sah tetap dibuat sebagai baris bermasalah:
 * perangkat sudah ter-inject, jadi catatannya tak boleh hilang. Item atau lokasi kosong (katalog tak aktif) ditandai
 * `unresolved` supaya pengguna melengkapinya di tabel.
 */
export function buildInjectedRow(
  input: InjectedRowInput,
  ctx: { clientId: string; now: Date },
): StagingRow {
  const serial = normalizeSerial(input.serial);
  const at = input.injectedAt === undefined ? Number.NaN : Date.parse(input.injectedAt);
  const now = Number.isNaN(at) ? ctx.now : new Date(at);
  const problem = serialProblem(serial);
  const unresolved: ('item' | 'location')[] = [];
  if (input.itemId === '') unresolved.push('item');
  if (input.locationId === '') unresolved.push('location');
  return {
    clientId: input.clientId ?? ctx.clientId,
    serial,
    itemId: input.itemId,
    itemLabel: input.itemLabel,
    buId: input.buId,
    buLabel: input.buLabel,
    testDate: todayWib(now.getTime()),
    locationId: input.locationId,
    locationLabel: input.locationLabel,
    sample: false,
    note: '',
    capturedAt: now.toISOString(),
    source: 'countrylock',
    stickers: null,
    proofPhotos: [],
    selected: false,
    ...(problem === null
      ? {}
      : {
          result: 'invalid' as const,
          message: problem === 'empty' ? 'Serial tidak boleh kosong' : 'Serial tidak sah',
        }),
    ...(unresolved.length > 0 ? { unresolved } : {}),
  };
}
