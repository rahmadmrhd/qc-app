/**
 * Cakupan hak "bagikan dashboard" (spek dashboard bagian 7, 7a, 9; keputusan pemilik 2026-11-24): satu helper untuk SEMUA
 * rute tautan dan laporan terjadwal, jadi tidak ada gerbang yang menyimpang.
 *
 * - `dashboard: edit`   = mengelola PENUH milik sendiri (pemilik tautan = pembagi, pemilik laporan = pembuat).
 * - `dashboard: manage` = semua milik SEMUA pengguna (termasuk penerima, pratinjau, dan tautan terbitan laporan orang
 *   lain); super admin sama dengan `manage`.
 * Baris orang lain bagi pemegang `edit` dijawab `NOT_FOUND` seragam (bukan `FORBIDDEN`) agar keberadaannya tak dapat
 * ditebak. Hak PEMILIK saat kirim/halaman publik tetap dihitung terpisah (`servableShare`, `ownerCheck`): syaratnya
 * minimal `edit`.
 */
import type { UserContext } from '@server/modules/access/context';
import { hasLevel } from '@shared/permissions';

export type DashboardAccessScope = 'all' | 'own';

/** `all` untuk super admin atau `manage`, `own` untuk `edit`, `null` tanpa hak. */
export function dashboardScopeOf(user: UserContext): DashboardAccessScope | null {
  if (user.isSuperAdmin || hasLevel(user.permissions.dashboard, 'manage')) return 'all';
  if (hasLevel(user.permissions.dashboard, 'edit')) return 'own';
  return null;
}

/** Pemilik baris, atau pengelola semua (`manage`/super admin), boleh mengelola baris itu secara penuh. */
export function mayManageRow(user: UserContext, owner: string): boolean {
  const scope = dashboardScopeOf(user);
  if (scope === 'all') return true;
  return scope === 'own' && owner === user.email;
}

/** Pemegang hak (minimal `edit`) memenuhi syarat sebagai pemilik tautan/laporan yang masih boleh dilayani. */
export function mayOwnDashboardItems(user: UserContext): boolean {
  return hasLevel(user.permissions.dashboard, 'edit');
}
