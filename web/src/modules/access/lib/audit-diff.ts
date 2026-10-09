import type { AuditSnapshot } from '@shared/rpc';

export type ChangeKind = 'added' | 'removed' | 'changed' | 'unchanged';

export interface ChildDiff {
  label: string;
  kind: ChangeKind;
  before?: unknown;
  after?: unknown;
}

export interface FieldDiff {
  key: string;
  kind: ChangeKind;
  before: unknown;
  after: unknown;
  /** Rincian per item untuk field berupa daftar (roleIds) atau objek (permissions). */
  children?: ChildDiff[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item) => b.includes(item));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) => key in a && key in b && sameValue(a[key], b[key]));
  }
  return a === b;
}

export function diffList(before: unknown, after: unknown): ChildDiff[] {
  const prev = Array.isArray(before) ? before : [];
  const next = Array.isArray(after) ? after : [];
  const children: ChildDiff[] = next.map((item) => ({
    label: String(item),
    kind: prev.includes(item) ? 'unchanged' : 'added',
  }));
  for (const item of prev) {
    if (!next.includes(item)) children.push({ label: String(item), kind: 'removed' });
  }
  return children;
}

function objectChildren(before: unknown, after: unknown): ChildDiff[] {
  const prev = isPlainObject(before) ? before : {};
  const next = isPlainObject(after) ? after : {};
  const keys = [...new Set([...Object.keys(next), ...Object.keys(prev)])];
  return keys.map((key) => {
    const inPrev = key in prev;
    const inNext = key in next;
    const kind: ChangeKind = !inPrev
      ? 'added'
      : !inNext
        ? 'removed'
        : sameValue(prev[key], next[key])
          ? 'unchanged'
          : 'changed';
    return { label: key, kind, before: prev[key], after: next[key] };
  });
}

function childrenOf(before: unknown, after: unknown): ChildDiff[] | undefined {
  if (Array.isArray(before) || Array.isArray(after)) return diffList(before, after);
  if (isPlainObject(before) || isPlainObject(after)) return objectChildren(before, after);
  return undefined;
}

/**
 * Bandingkan dua snapshot audit field demi field. before = null berarti create (semua ditambah),
 * after = null berarti delete (semua dihapus). Urutan field: kunci `after` dahulu, lalu yang hanya ada di `before`.
 */
export function diffSnapshots(before: AuditSnapshot, after: AuditSnapshot): FieldDiff[] {
  const keys = [...new Set([...Object.keys(after ?? {}), ...Object.keys(before ?? {})])];
  return keys.map((key) => {
    const prev = before?.[key];
    const next = after?.[key];
    const kind: ChangeKind =
      before === null
        ? 'added'
        : after === null
          ? 'removed'
          : !(key in before)
            ? 'added'
            : !(key in after)
              ? 'removed'
              : sameValue(prev, next)
                ? 'unchanged'
                : 'changed';
    const children = childrenOf(
      kind === 'added' ? undefined : prev,
      kind === 'removed' ? undefined : next,
    );
    return { key, kind, before: prev, after: next, ...(children ? { children } : {}) };
  });
}
