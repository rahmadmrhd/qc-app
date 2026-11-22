import type { MeDto, SerialDto } from '@shared/contract';
import type { SerialFlowState } from '@shared/serial-flow';
import type { SerialStatus } from '@shared/serials';
import { type ReactNode, useState } from 'react';
import type { ActionKind } from '@/components/action-button';
import type { ViewAction } from '@/components/page/view-page';
import { buIdsWithLevelOf, serialActorModules } from '@/modules/auth/permissions';
import { type ActKind, actButtonSpecs } from '../components/act-buttons';
import { ActDialog } from '../components/act-dialog';

/** Ikon per aksi alur (labelnya dari `actButtonSpecs`, jadi hanya ikon yang dipilih di sini). */
const FLOW_ICON: Record<Exclude<ActKind, 'report' | 'stickers'>, ActionKind> = {
  send: 'upload',
  receive: 'download',
  diagnosis: 'view',
  recheck: 'refresh',
  note: 'edit',
};

/** Yang dibutuhkan untuk menentukan aksi mana yang tersedia: keadaan alur dan BU serial. */
export type SerialActionSubject = SerialFlowState & { buId: string };

/** Halaman pemakai: detail Serial atau detail Laporan (menentukan bobot aksi utama). */
export type SerialActionContext = 'serial' | 'case';

/** Kunci aksi di header: jenis dialog alur ditambah "Ubah data" (`edit`, bukan dialog alur). */
export type SerialActionKey = ActKind | 'edit';

/** Urutan butir di menu "Aksi lainnya" (yang bukan aksi utama). */
const MENU_ORDER: readonly SerialActionKey[] = [
  'report',
  'edit',
  'stickers',
  'send',
  'receive',
  'diagnosis',
  'recheck',
  'note',
];

/**
 * Bobot aksi alur menurut status serial: yang paling sering dikerjakan di tahap itu, dan oleh siapa. Dipakai detail
 * Laporan, serta detail Serial bila Ubah data bukan prioritas (status Dilaporkan) atau pengguna tak boleh mengubah
 * data (mis. tim servis). Disaring ke aksi yang tersedia (hak dan posisi unit) oleh `primaryKindsOf`.
 */
const FLOW_WEIGHT: Partial<Record<SerialStatus, readonly SerialActionKey[]>> = {
  reported: ['recheck', 'send'],
  at_service: ['receive', 'diagnosis'],
  diagnosis: ['diagnosis'],
  service_repair: ['diagnosis'],
  recheck: ['receive', 'recheck'],
};

/**
 * Aksi utama (maks. 2-3; sisanya di menu "Aksi lainnya") untuk keadaan serial, urut bobot (keputusan pemilik
 * 2026-11-22, K7). Murni: `available` = aksi yang boleh dikerjakan pengguna pada keadaan itu (alur dari
 * `actButtonSpecs`, `edit` bila boleh mengubah data, `report` bila boleh melapor). Hasil hanya memuat yang tersedia;
 * kosong = tak ada pilihan (`ViewPage` punya cadangan sendiri).
 *  - Laporan: bobot alur menurut status.
 *  - Serial: Lolos = Lapor rusak + Ubah data; Dilaporkan = bobot alur (Ubah data ke menu); status lain = Ubah data
 *    bila boleh, selain itu bobot alur (agar tim servis langsung melihat Terima/Diagnosis).
 */
export function primaryKindsOf(
  context: SerialActionContext,
  state: Pick<SerialFlowState, 'status'>,
  available: readonly SerialActionKey[],
): SerialActionKey[] {
  const only = (keys: readonly SerialActionKey[]) => keys.filter((key) => available.includes(key));
  const flow = only(FLOW_WEIGHT[state.status] ?? []);
  if (context === 'case') return flow;
  if (state.status === 'good') return only(['report', 'edit']);
  if (state.status === 'reported') return flow;
  return available.includes('edit') ? ['edit'] : flow;
}

export interface UseSerialActionsOptions {
  me: MeDto;
  /** Halaman pemakai: bobot aksi utama berbeda antara detail Serial dan detail Laporan. */
  context: SerialActionContext;
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
 * Aksi Serial Number untuk header View (detail Serial dan detail Laporan, satu sumber agar label, ikon, dan dialog tak
 * ganda): Lapor rusak, Ubah data, Tempel stiker, Kirim ke servis, Terima, Diagnosis, Cek ulang, dan Catatan, semuanya
 * entri DATAR. Aksi utama (maks. 3, menurut `primaryKindsOf`) berada di depan dan bertanda `primary`; sisanya urut
 * `MENU_ORDER` masuk menu "Aksi lainnya" oleh `ViewPage`. Ketersediaan mengikuti tabel transisi (`availableActions`,
 * sumber yang sama dengan server). `dialog` = `ActDialog` yang terbuka; render sekali di halaman. Hapus/Pulihkan tetap
 * milik halaman.
 */
export function useSerialActions({
  me,
  context,
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
  const has = (kind: ActKind) => specs.some((spec) => spec.kind === kind);
  const flowEntry = (kind: Exclude<ActKind, 'report' | 'stickers'>): ViewAction => ({
    id: `flow-${kind}`,
    action: FLOW_ICON[kind],
    label: specs.find((spec) => spec.kind === kind)?.label ?? kind,
    busy: pending,
    hidden: !has(kind),
    onSelect: () => setActing(kind),
  });
  const entries: Record<SerialActionKey, ViewAction> = {
    report: {
      id: 'report',
      action: 'reportDamage',
      hidden: !report || !has('report'),
      onSelect: () => setActing('report'),
    },
    edit: {
      id: 'edit',
      action: 'edit',
      label: 'Ubah data',
      hidden: !onEdit || !canEdit,
      onSelect: () => onEdit?.(),
    },
    stickers: {
      id: 'stickers',
      action: 'stickers',
      busy: pending,
      hidden: !has('stickers'),
      onSelect: () => setActing('stickers'),
    },
    send: flowEntry('send'),
    receive: flowEntry('receive'),
    diagnosis: flowEntry('diagnosis'),
    recheck: flowEntry('recheck'),
    note: flowEntry('note'),
  };
  const available = MENU_ORDER.filter((key) => !entries[key].hidden);
  const primary: SerialActionKey[] = subject
    ? primaryKindsOf(context, { status: subject.status }, available)
    : [];
  const ordered = [...primary, ...MENU_ORDER.filter((key) => !primary.includes(key))];
  const items: ViewAction[] = ordered.map((key) =>
    primary.includes(key) ? { ...entries[key], primary: true } : entries[key],
  );
  return {
    items,
    dialog:
      acting && serial ? (
        <ActDialog serial={serial} kind={acting} onClose={() => setActing(null)} />
      ) : null,
  };
}
