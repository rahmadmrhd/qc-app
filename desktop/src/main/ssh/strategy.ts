import type { Brand } from '@countrylock/script-template';
import type { SentinelStrategy } from './inject-session';

/**
 * Strategi penanda menurut merk perangkat tujuan sesi.
 * MENUNGGU HASIL SPIKE T9: nilai Mikrotik `put` (`:put <token>`, perintah RouterOS yang valid)
 * belum teruji di router nyata; aplikasi lama memakai `echo` untuk keduanya. Ubah sesuai laporan
 * spike perangkat (docs/superpowers/spikes/2026-11-hardware-spike.md) sebelum Task 18.
 */
export const SENTINEL_BY_BRAND: Record<Brand, SentinelStrategy> = {
  mikrotik: 'put',
  ubiquiti: 'echo',
};
