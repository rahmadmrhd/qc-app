import { ALL_LOCATIONS_KEY } from '@shared/assignments';
import { ALL_BU_KEY } from '@shared/business-units';
import { LinkCell } from '@/components/data-table';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import type { AssignmentLabels, NamedRef } from '../lib/assignment-labels';

export type AssignmentKind = 'location' | 'businessUnit';

export interface AssignmentChipEntry {
  /** Id lokasi atau BU; `null` = Semua lokasi / Semua BU. */
  scopeId: string | null;
  roleIds: readonly string[];
}

export interface AssignmentChipsProps {
  kind: AssignmentKind;
  entries: readonly AssignmentChipEntry[];
  labels: AssignmentLabels;
  /** Tautan ke View hanya bila pengguna berhak (`locationLinkAccess`, `businessUnitLinkAccess`, `roleLinkAccess`). */
  canOpenScope?: boolean;
  canOpenRole?: boolean;
}

/** Nama yang menaut ke View-nya bila boleh dan record masih ada; record terhapus selalu teks + penanda Terhapus. */
function NameLink({
  target: named,
  to,
  params,
  canOpen,
}: {
  target: NamedRef;
  to:
    | '/access/locations/$locationId'
    | '/access/business-units/$businessUnitId'
    | '/access/roles/$roleId';
  params: Record<string, string>;
  canOpen: boolean;
}) {
  if (named.deleted) {
    return (
      <span className="inline-flex items-center gap-1">
        {named.name}
        <DeletedBadge />
      </span>
    );
  }
  return canOpen ? (
    <LinkCell to={to} params={params}>
      {named.name}
    </LinkCell>
  ) : (
    <span>{named.name}</span>
  );
}

/**
 * Penugasan pengguna sebagai lencana "lokasi/BU : role, role" (tabel, kartu ponsel, dan View). Lokasi/BU dan role
 * menaut ke View-nya hanya bila pemakai berhak; yang terhapus tampil bertanda "Terhapus" tanpa tautan.
 */
export function AssignmentChips({
  kind,
  entries,
  labels,
  canOpenScope = false,
  canOpenRole = false,
}: AssignmentChipsProps) {
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map((entry) => {
        const scopeId = entry.scopeId;
        const key = scopeId ?? (kind === 'location' ? ALL_LOCATIONS_KEY : ALL_BU_KEY);
        return (
          <span
            key={key}
            className="inline-flex flex-wrap items-center gap-x-1 rounded-md border px-2 py-0.5 text-xs"
          >
            {scopeId === null ? (
              <span>{kind === 'location' ? 'Semua lokasi' : 'Semua BU'}</span>
            ) : kind === 'location' ? (
              <NameLink
                target={labels.location(scopeId)}
                to="/access/locations/$locationId"
                params={{ locationId: scopeId }}
                canOpen={canOpenScope}
              />
            ) : (
              <NameLink
                target={labels.businessUnit(scopeId)}
                to="/access/business-units/$businessUnitId"
                params={{ businessUnitId: scopeId }}
                canOpen={canOpenScope}
              />
            )}
            <span aria-hidden>:</span>
            {entry.roleIds.map((roleId, index) => (
              <span key={roleId} className="inline-flex items-center">
                <NameLink
                  target={labels.role(roleId)}
                  to="/access/roles/$roleId"
                  params={{ roleId }}
                  canOpen={canOpenRole}
                />
                {index < entry.roleIds.length - 1 ? ',' : ''}
              </span>
            ))}
          </span>
        );
      })}
    </div>
  );
}
