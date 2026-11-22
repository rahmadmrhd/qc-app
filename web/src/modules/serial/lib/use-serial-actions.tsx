import type { MeDto, SerialDto } from '@shared/contract';
import type { SerialFlowState } from '@shared/serial-flow';
import { type ReactNode, useState } from 'react';
import type { ActionKind } from '@/components/action-button';
import type { ViewAction } from '@/components/page/view-page';
import { buIdsWithLevelOf, serialActorModules } from '@/modules/auth/permissions';
import { type ActKind, actButtonSpecs } from '../components/act-buttons';
import { ActDialog } from '../components/act-dialog';

/** Ikon per aksi alur di dropdown "Update" (labelnya dari `actButtonSpecs`, jadi hanya ikon yang dipilih di sini). */
const FLOW_MENU_ICON: Record<Exclude<ActKind, 'report' | 'stickers'>, ActionKind> = {
  send: 'upload',
  receive: 'download',
  diagnosis: 'view',
  recheck: 'refresh',
  note: 'edit',
};

/** Yang dibutuhkan untuk menentukan aksi mana yang tersedia: keadaan alur dan BU serial. */
export type SerialActionSubject = SerialFlowState & { buId: string };

export interface UseSerialActionsOptions {
  me: MeDto;
  /**
   * Serial yang aksinya ditampilkan; `undefined` = belum diketahui (belum dimuat atau tak ada aksi yang boleh):
   * semua entri tersembunyi. Detail laporan memberi keadaan dari data laporan dan memuat `serial` hanya bila ada aksi.
   */
  subject: SerialActionSubject | undefined;
  /** `SerialDto` lengkap untuk dialog (`updatedAt`, stiker, riwayat BU); `undefined` selama dimuat. */
  serial: SerialDto | undefined;
  /** `serial` sedang dimuat: entri tampil sibuk (nonaktif) sampai siap. */
  pending?: boolean;
  /** Semua aksi disembunyikan (serial terhapus, laporan sudah selesai). */
  hidden?: boolean;
  /** Menyertakan "Lapor rusak" (detail Serial; tidak untuk detail Laporan, yang sudah punya laporan). */
  report?: boolean;
  /** Menyertakan "Ubah data" bila diberikan dan pengguna boleh menulis di BU serial (detail Serial). */
  onEdit?: (() => void) | undefined;
}

/**
 * Aksi alur Serial Number untuk header View (detail Serial dan detail Laporan, satu sumber agar urutan, label, ikon, dan
 * dialog tak ganda): Lapor rusak (utama), Ubah data (utama), Tempel stiker, lalu "Update" (entri bersubmenu: Kirim ke
 * servis, Terima, Diagnosis, Cek ulang, Catatan). Ketersediaan mengikuti tabel transisi (`availableActions`, sumber yang
 * sama dengan server). `dialog` = `ActDialog` yang terbuka; render sekali di halaman. Hapus/Pulihkan tetap milik halaman.
 */
export function useSerialActions({
  me,
  subject,
  serial,
  pending = false,
  hidden = false,
  report = false,
  onEdit,
}: UseSerialActionsOptions): { items: ViewAction[]; dialog: ReactNode } {
  const [acting, setActing] = useState<ActKind | null>(null);
  const specs =
    hidden || !subject
      ? []
      : actButtonSpecs(
          { status: subject.status, custody: subject.custody },
          serialActorModules(me, subject.buId),
        );
  const canEdit =
    !hidden &&
    subject !== undefined &&
    buIdsWithLevelOf(me, 'serial', 'edit').includes(subject.buId);
  const flow = specs.filter((spec) => spec.kind !== 'report' && spec.kind !== 'stickers');
  const items: ViewAction[] = [];
  if (report) {
    items.push({
      id: 'report',
      action: 'reportDamage',
      primary: true,
      hidden: !specs.some((spec) => spec.kind === 'report'),
      onSelect: () => setActing('report'),
    });
  }
  if (onEdit) {
    items.push({
      id: 'edit',
      action: 'edit',
      label: 'Ubah data',
      primary: true,
      hidden: !canEdit,
      onSelect: onEdit,
    });
  }
  items.push(
    {
      id: 'stickers',
      action: 'stickers',
      busy: pending,
      hidden: !specs.some((spec) => spec.kind === 'stickers'),
      onSelect: () => setActing('stickers'),
    },
    {
      id: 'update',
      action: 'update',
      label: 'Update',
      shortLabel: 'Update',
      busy: pending,
      hidden: flow.length === 0,
      onSelect: () => undefined,
      submenu: flow.map((spec) => ({
        id: `flow-${spec.kind}`,
        action: FLOW_MENU_ICON[spec.kind as keyof typeof FLOW_MENU_ICON],
        label: spec.label,
        onSelect: () => setActing(spec.kind),
      })),
    },
  );
  return {
    items,
    dialog:
      acting && serial ? (
        <ActDialog serial={serial} kind={acting} onClose={() => setActing(null)} />
      ) : null,
  };
}
