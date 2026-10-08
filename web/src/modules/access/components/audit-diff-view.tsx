import { LEVEL_LABELS, MODULE_LABELS } from '@shared/permissions';
import type { AuditSnapshot } from '@shared/rpc';
import type { LucideIcon } from 'lucide-react';
import { Minus, Pencil, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChangeKind, ChildDiff, FieldDiff } from '../lib/audit-diff';
import { diffSnapshots } from '../lib/audit-diff';

const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  name: 'Nama',
  status: 'Status',
  roleIds: 'Role',
  description: 'Deskripsi',
  permissions: 'Akses per modul',
};

const STATUS_LABELS: Record<string, string> = { active: 'Aktif', inactive: 'Nonaktif' };

interface KindStyle {
  label: string;
  icon: LucideIcon;
  box: string;
  tag: string;
}

const KIND_STYLES: Record<Exclude<ChangeKind, 'unchanged'>, KindStyle> = {
  added: {
    label: 'Ditambah',
    icon: Plus,
    box: 'border-emerald-500/60 bg-emerald-500/10',
    tag: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200',
  },
  changed: {
    label: 'Diubah',
    icon: Pencil,
    box: 'border-amber-500/60 bg-amber-500/10',
    tag: 'bg-amber-500/20 text-amber-900 dark:text-amber-200',
  },
  removed: {
    label: 'Dihapus',
    icon: Minus,
    box: 'border-red-500/60 bg-red-500/10',
    tag: 'bg-red-500/20 text-red-800 dark:text-red-200',
  },
};

function formatScalar(key: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (key === 'status' && typeof value === 'string') return STATUS_LABELS[value] ?? value;
  return String(value);
}

function KindTag({ kind }: { kind: ChangeKind }) {
  if (kind === 'unchanged') return null;
  const { label, icon: Icon, tag } = KIND_STYLES[kind];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
        tag,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

function Del({ children }: { children: string }) {
  return <del className="text-muted-foreground line-through decoration-2">{children}</del>;
}

function Ins({ children }: { children: string }) {
  return <ins className="font-medium no-underline">{children}</ins>;
}

function ChildItem({
  fieldKey,
  child,
  roleNames,
}: {
  fieldKey: string;
  child: ChildDiff;
  roleNames: ReadonlyMap<string, string>;
}) {
  const isPermission = fieldKey === 'permissions';
  const label = isPermission
    ? (MODULE_LABELS[child.label as keyof typeof MODULE_LABELS] ?? child.label)
    : (roleNames.get(child.label) ?? child.label);
  const level = (value: unknown) =>
    typeof value === 'string' ? (LEVEL_LABELS[value as keyof typeof LEVEL_LABELS] ?? value) : '';
  const style = child.kind === 'unchanged' ? null : KIND_STYLES[child.kind];
  const Icon = style?.icon;

  let value: React.ReactNode = null;
  if (isPermission) {
    if (child.kind === 'changed') {
      value = (
        <>
          <Del>{level(child.before)}</Del> → <Ins>{level(child.after)}</Ins>
        </>
      );
    } else if (child.kind === 'removed') {
      value = <Del>{level(child.before)}</Del>;
    } else {
      value = <Ins>{level(child.after)}</Ins>;
    }
  }

  return (
    <li
      data-kind={child.kind}
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm',
        style ? style.box : 'border-transparent bg-muted/50',
      )}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
      {style ? <span className="sr-only">{style.label}: </span> : null}
      <span data-slot="label" className={child.kind === 'removed' ? 'line-through' : undefined}>
        {label}
      </span>
      {isPermission ? <span aria-hidden="true">:</span> : null}
      {value}
    </li>
  );
}

function FieldRow({
  field,
  roleNames,
}: {
  field: FieldDiff;
  roleNames: ReadonlyMap<string, string>;
}) {
  const style = field.kind === 'unchanged' ? null : KIND_STYLES[field.kind];
  return (
    <div
      data-field={field.key}
      data-kind={field.kind}
      className={cn('space-y-1.5 rounded-lg border p-3', style ? style.box : 'border-border')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{FIELD_LABELS[field.key] ?? field.key}</span>
        <KindTag kind={field.kind} />
      </div>
      {field.children ? (
        field.children.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-1">
            {field.children.map((child) => (
              <ChildItem
                key={child.label}
                fieldKey={field.key}
                child={child}
                roleNames={roleNames}
              />
            ))}
          </ul>
        )
      ) : (
        <p className="break-words text-sm">
          {field.kind === 'changed' ? (
            <>
              <Del>{formatScalar(field.key, field.before)}</Del> →{' '}
              <Ins>{formatScalar(field.key, field.after)}</Ins>
            </>
          ) : field.kind === 'removed' ? (
            <Del>{formatScalar(field.key, field.before)}</Del>
          ) : (
            <Ins>{formatScalar(field.key, field.after)}</Ins>
          )}
        </p>
      )}
    </div>
  );
}

function Legend() {
  return (
    <ul aria-label="Keterangan warna" className="flex flex-wrap gap-2">
      {(Object.keys(KIND_STYLES) as Array<keyof typeof KIND_STYLES>).map((kind) => (
        <li key={kind}>
          <KindTag kind={kind} />
        </li>
      ))}
    </ul>
  );
}

export interface AuditDiffViewProps {
  before: AuditSnapshot;
  after: AuditSnapshot;
  /** Nama role untuk menggantikan id pada field roleIds; id tampil apa adanya bila tidak ada. */
  roleNames?: ReadonlyMap<string, string>;
}

/** Menampilkan satu entri audit sebagai form baca-saja; field yang ditambah, diubah, atau dihapus diberi warna dan penanda teks. */
export function AuditDiffView({ before, after, roleNames = new Map() }: AuditDiffViewProps) {
  const fields = diffSnapshots(before, after);
  return (
    <div className="space-y-3">
      <Legend />
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada data perubahan yang tercatat.</p>
      ) : (
        fields.map((field) => <FieldRow key={field.key} field={field} roleNames={roleNames} />)
      )}
    </div>
  );
}
