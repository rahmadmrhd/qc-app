import type { MeDto } from '@shared/contract';
import { stepsFor } from './offer';
import type { GuideEntry, GuideStep } from './types';

/**
 * Langkah yang masih dapat ditampilkan: lolos `izin` per langkah (`stepsFor`), dan langkah di halaman sekarang
 * (tanpa `route`) hanya bila targetnya ada menurut `queryTarget`. Langkah ber-`route` selalu dipertahankan karena
 * targetnya baru muncul setelah navigasi. Mesin tur TIDAK memakai ini untuk menyaring di awal (target diperiksa
 * sambil tur berjalan, dengan menunggu sampai `TARGET_WAIT_MS`); fungsi ini untuk penilaian sesaat atas langkah sisa.
 */
export function resolveSteps(
  entry: GuideEntry,
  me: MeDto,
  activeLocationIds: readonly string[] | undefined,
  queryTarget: (target: string) => Element | null,
): GuideStep[] {
  return stepsFor(entry, me, activeLocationIds).filter(
    (step) => step.route !== undefined || queryTarget(step.target) !== null,
  );
}
