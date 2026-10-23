import type { HandoverStatus } from '@shared/handover';

export interface HandoverActionPermissions {
  /** `qc: edit` di lokasi task. */
  canMarkDone: boolean;
  /** `handover: edit` di lokasi task. */
  canEdit: boolean;
  /** `handover: manage` di lokasi task. */
  canManage: boolean;
}

export interface HandoverActions {
  /** Tombol Mark done tampil (hanya Baru dan Dikerjakan); `markDoneEnabled` bila `qc: edit`. */
  markDone: boolean;
  markDoneEnabled: boolean;
  /** "Buka kembali" hanya untuk task Dibatalkan (`handover: manage`). */
  reopen: boolean;
  edit: boolean;
  cancel: boolean;
  /** Menu More hanya bila ada aksi di dalamnya. */
  more: boolean;
}

/** Aksi kartu/detail menurut status turunan dan izin (spek §12.1). */
export function handoverActions(
  status: HandoverStatus,
  permissions: HandoverActionPermissions,
): HandoverActions {
  const open = status === 'new' || status === 'in_progress';
  const edit = permissions.canEdit && status !== 'cancelled';
  const cancel = permissions.canManage && open;
  return {
    markDone: open,
    markDoneEnabled: open && permissions.canMarkDone,
    reopen: status === 'cancelled' && permissions.canManage,
    edit,
    cancel,
    more: edit || cancel,
  };
}
