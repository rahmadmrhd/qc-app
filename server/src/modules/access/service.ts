import { listAudit, writeAudit } from '@server/core/audit';
import { normalizeEmail } from '@server/core/email';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { type PlanOutcome, runRecordBatch, runSingleRecord } from '@server/core/record-batch';
import {
  type LifecycleSpec,
  planRestore,
  planSoftDelete,
  planStatusChange,
} from '@server/core/record-lifecycle';
import type { Assignment } from '@shared/assignments';
import { assignmentKey, resolveAccess } from '@shared/assignments';
import type {
  BatchResult,
  IdBatchInput,
  ListStatusFilter,
  RemoveBatchResult,
  RemoveResult,
  StatusBatchInput,
} from '@shared/batch';
import type { BuAssignment } from '@shared/business-units';
import { ALL_BU_KEY } from '@shared/business-units';
import type {
  AuditCursorPageDto,
  DeleteRoleInput,
  GetRoleInput,
  GetUserInput,
  ListAuditPageInput,
  ListRolesInput,
  ListUsersInput,
  RoleDto,
  SaveRoleInput,
  SaveUserInput,
  SetUserStatusInput,
  UserDto,
} from '@shared/contract';
import { hasLevel, sanitizePermissions } from '@shared/permissions';
import type { UserContext } from './context';
import type {
  AccessTables,
  BusinessUnitRecord,
  LocationRecord,
  RoleRecord,
  UserRecord,
} from './repo';
import {
  batchWrite,
  createAccessTablesCache,
  deletedInfoOf,
  insertRoleStmt,
  insertUserStmt,
  isLiveRecord,
  loadAccessTables,
  updateRoleStmt,
  updateUserStmt,
} from './repo';
import { PAGE_DEFAULT_LIMIT, parseAuditCursor } from './validate';

/** Id role pada penugasan (lokasi dan BU) yang sudah terhapus: form menampilkan "Terhapus"; izinnya tak berlaku. */
function deletedRoleIdsOf(user: UserRecord, roles: readonly RoleRecord[]): string[] {
  const deleted = new Set(roles.filter((role) => !isLiveRecord(role)).map((role) => role.id));
  const used = new Set<string>();
  for (const entry of user.assignments) for (const id of entry.roleIds) used.add(id);
  for (const entry of user.buAssignments) for (const id of entry.roleIds) used.add(id);
  return [...used].filter((id) => deleted.has(id)).sort();
}

function toUserDto(env: Env, user: UserRecord, roles: readonly RoleRecord[]): UserDto {
  const deleted = deletedInfoOf(user);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    assignments: user.assignments.map((entry) => ({
      locationId: entry.locationId,
      roleIds: [...entry.roleIds],
    })),
    buAssignments: user.buAssignments.map((entry) => ({
      buId: entry.buId,
      roleIds: [...entry.roleIds],
    })),
    sharedAccount: user.sharedAccount,
    superAdmin: isSuperAdminEmail(env, user.email),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    updatedBy: user.updatedBy,
    deletedRoleIds: deletedRoleIdsOf(user, roles),
    ...(deleted ? { deleted } : {}),
  };
}

function usesRole(user: UserRecord, roleId: string): boolean {
  return (
    user.assignments.some((entry) => entry.roleIds.includes(roleId)) ||
    user.buAssignments.some((entry) => entry.roleIds.includes(roleId))
  );
}

/** Jumlah pengguna HIDUP yang memakai role (pengguna terhapus tidak dihitung dan tidak menghalangi hapus role). */
function liveUsageOf(users: readonly UserRecord[], roleId: string): number {
  return users.filter((user) => isLiveRecord(user) && usesRole(user, roleId)).length;
}

function toRoleDto(role: RoleRecord, users: readonly UserRecord[]): RoleDto {
  const deleted = deletedInfoOf(role);
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: { ...role.permissions },
    userCount: liveUsageOf(users, role.id),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
    updatedBy: role.updatedBy,
    ...(deleted ? { deleted } : {}),
  };
}

/** Terbaru dahulu; filter aksi persis dan kata kunci (target/pelaku) tidak peka huruf besar. */
export function listAuditPage(env: Env, params: ListAuditPageInput): Promise<AuditCursorPageDto> {
  const cursor = params.cursor ? parseAuditCursor(params.cursor) : null;
  return listAudit(env, {
    ...(cursor ? { cursor } : {}),
    limit: params.limit ?? PAGE_DEFAULT_LIMIT,
    action: params.action ?? '',
    ...(params.actions ? { actions: params.actions } : {}),
    query: params.query ?? '',
  });
}

/** Peta lokasi -> role (kunci `*` = Semua lokasi); bentuk yang mudah dibandingkan per lokasi pada diff audit. */
function assignmentsSnapshot(assignments: readonly Assignment[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const entry of assignments) map[assignmentKey(entry.locationId)] = [...entry.roleIds];
  return map;
}

/** Peta kode BU (`*` = Semua BU; id bila BU tak lagi ada) -> role; pola `assignmentsSnapshot`. */
function buAssignmentsSnapshot(
  assignments: readonly BuAssignment[],
  businessUnits: readonly BusinessUnitRecord[],
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const entry of assignments) {
    const key =
      entry.buId === null
        ? ALL_BU_KEY
        : (businessUnits.find((bu) => bu.id === entry.buId)?.code ?? entry.buId);
    map[key] = [...entry.roleIds];
  }
  return map;
}

/** Snapshot audit: hanya field bisnis (metadata baris sudah ada di ts/actor). Penugasan memakai id/kode. */
export function userSnapshot(
  user: UserRecord,
  businessUnits: readonly BusinessUnitRecord[],
): Record<string, unknown> {
  return {
    email: user.email,
    name: user.name,
    status: user.status,
    assignments: assignmentsSnapshot(user.assignments),
    buAssignments: buAssignmentsSnapshot(user.buAssignments, businessUnits),
    sharedAccount: user.sharedAccount,
  };
}

export function roleSnapshot(role: RoleRecord): Record<string, unknown> {
  return { name: role.name, description: role.description, permissions: { ...role.permissions } };
}

/**
 * Daftar "boleh melihat yang terhapus": hanya `access: manage` (mirip merk dan item). `actor` kosong (pemanggil
 * internal/tes) dianggap tak berhak.
 */
function canSeeDeleted(actor: UserContext | undefined): boolean {
  return actor !== undefined && hasLevel(actor.permissions.access, 'manage');
}

function assertCanListDeleted(filter: ListStatusFilter | undefined, actor?: UserContext): void {
  if (filter === 'deleted' && !canSeeDeleted(actor)) {
    throw appError('FORBIDDEN', 'Anda tidak berhak melihat data terhapus');
  }
}

/** Daftar pengguna: bawaan hidup (aktif + nonaktif); `deleted` hanya bagi `access: manage`. */
export async function listUserDtos(
  env: Env,
  input?: ListUsersInput | null,
  actor?: UserContext,
): Promise<UserDto[]> {
  const filter = input?.status;
  assertCanListDeleted(filter, actor);
  const { users, roles } = await loadAccessTables(env);
  return users
    .filter((user) => (filter === 'deleted' ? !isLiveRecord(user) : isLiveRecord(user)))
    .filter((user) => filter !== 'active' || user.status === 'active')
    .filter((user) => filter !== 'inactive' || user.status === 'inactive')
    .map((user) => toUserDto(env, user, roles))
    .sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * Gerbang baca untuk `activity.list` atas pengguna, role, lokasi, dan BU: aturan yang sama dengan rute `get` keempatnya
 * (`access: view`; record terhapus hanya bagi `access: manage`, selain itu dan id tak dikenal `NOT_FOUND` seragam).
 */
export async function assertAccessRecordReadable(
  env: Env,
  table: 'users' | 'roles' | 'locations' | 'businessUnits',
  id: string,
  actor: UserContext,
): Promise<void> {
  const tables = await loadAccessTables(env);
  const records: readonly { id: string; deletedAt: string }[] = tables[table];
  const record = records.find((item) => item.id === id);
  if (!record || (!isLiveRecord(record) && !canSeeDeleted(actor))) {
    throw appError('NOT_FOUND', 'Data tidak ditemukan');
  }
}

/** Satu pengguna menurut id. Terhapus hanya bagi `access: manage`; selain itu `NOT_FOUND` (seperti id tak dikenal). */
export async function getUserDto(
  env: Env,
  input: GetUserInput,
  actor: UserContext,
): Promise<UserDto> {
  const { users, roles } = await loadAccessTables(env);
  const user = users.find((record) => record.id === input.id);
  if (!user || (!isLiveRecord(user) && !canSeeDeleted(actor))) {
    throw appError('NOT_FOUND', 'User tidak ditemukan');
  }
  return toUserDto(env, user, roles);
}

/** Daftar role: bawaan hidup; `deleted` hanya bagi `access: manage`. Role tak punya status aktif/nonaktif. */
export async function listRoleDtos(
  env: Env,
  input?: ListRolesInput | null,
  actor?: UserContext,
): Promise<RoleDto[]> {
  const filter = input?.status;
  assertCanListDeleted(filter, actor);
  const { users, roles } = await loadAccessTables(env);
  return roles
    .filter((role) => (filter === 'deleted' ? !isLiveRecord(role) : isLiveRecord(role)))
    .map((role) => toRoleDto(role, users))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getRoleDto(
  env: Env,
  input: GetRoleInput,
  actor: UserContext,
): Promise<RoleDto> {
  const { users, roles } = await loadAccessTables(env);
  const role = roles.find((record) => record.id === input.id);
  if (!role || (!isLiveRecord(role) && !canSeeDeleted(actor))) {
    throw appError('NOT_FOUND', 'Role tidak ditemukan');
  }
  return toRoleDto(role, users);
}

/**
 * Role pada satu entri penugasan: harus ada (hidup atau terhapus). Role TERHAPUS hanya sah bila sudah tersimpan pada
 * entri yang sama (rujukan tersimpan, keputusan pemilik soft delete T1); yang baru harus hidup.
 */
function assertRolesUsable(
  roleIds: readonly string[],
  stored: ReadonlySet<string>,
  roles: readonly RoleRecord[],
  field: 'assignments' | 'buAssignments',
): void {
  for (const id of roleIds) {
    const role = roles.find((record) => record.id === id);
    if (!role || (!isLiveRecord(role) && !stored.has(id))) {
      throw appError('VALIDATION', 'Ada role yang tidak dikenal', {
        [field]: 'Ada role yang tidak dikenal',
      });
    }
  }
}

function assertAssignmentsValid(
  assignments: readonly Assignment[],
  roles: readonly RoleRecord[],
  locations: readonly LocationRecord[],
  existing: UserRecord | undefined,
): void {
  const storedByLocation = new Map(
    (existing?.assignments ?? []).map((entry) => [entry.locationId, new Set(entry.roleIds)]),
  );
  for (const entry of assignments) {
    assertRolesUsable(
      entry.roleIds,
      storedByLocation.get(entry.locationId) ?? new Set(),
      roles,
      'assignments',
    );
  }
  const previous = new Set((existing?.assignments ?? []).map((entry) => entry.locationId));
  for (const entry of assignments) {
    if (entry.locationId === null) continue;
    const location = locations.find((item) => item.id === entry.locationId);
    const usable =
      location &&
      ((isLiveRecord(location) && location.status === 'active') || previous.has(entry.locationId));
    if (!usable) {
      throw appError('VALIDATION', 'Lokasi tidak dikenal atau tidak aktif', {
        assignments: 'Lokasi tidak dikenal atau tidak aktif',
      });
    }
  }
}

/**
 * Penugasan BU: role dikenal; BU dikenal dan (hidup dan aktif, atau sudah tertugaskan pada user ini sebelumnya, agar
 * menyimpan user tidak gagal karena BU yang kemudian dinonaktifkan atau dihapus).
 */
function assertBuAssignmentsValid(
  buAssignments: readonly BuAssignment[],
  roles: readonly RoleRecord[],
  businessUnits: readonly BusinessUnitRecord[],
  existing: UserRecord | undefined,
): void {
  const storedByBu = new Map(
    (existing?.buAssignments ?? []).map((entry) => [entry.buId, new Set(entry.roleIds)]),
  );
  for (const entry of buAssignments) {
    assertRolesUsable(
      entry.roleIds,
      storedByBu.get(entry.buId) ?? new Set(),
      roles,
      'buAssignments',
    );
  }
  const previous = new Set((existing?.buAssignments ?? []).map((entry) => entry.buId));
  for (const entry of buAssignments) {
    if (entry.buId === null) continue;
    const bu = businessUnits.find((item) => item.id === entry.buId);
    const usable = bu && ((isLiveRecord(bu) && bu.status === 'active') || previous.has(entry.buId));
    if (!usable) {
      throw appError('VALIDATION', 'BU tidak dikenal atau tidak aktif', {
        buAssignments: 'BU tidak dikenal atau tidak aktif',
      });
    }
  }
}

/** Izin tiap role HIDUP; role terhapus tidak memberi hak (soft delete, keputusan pemilik 9). */
function livePermissionMap(roles: readonly RoleRecord[]) {
  return new Map(roles.filter(isLiveRecord).map((role) => [role.id, role.permissions] as const));
}

/** Admin non-super tidak boleh menyimpan perubahan yang menghilangkan Kelola global miliknya sendiri. */
function assertKeepsOwnAccess(
  assignments: readonly Assignment[],
  roles: readonly RoleRecord[],
  existing: UserRecord | undefined,
  actor: UserContext,
): void {
  if (actor.isSuperAdmin || !existing || existing.id !== actor.userId) return;
  if (!hasLevel(actor.permissions.access, 'manage')) return;
  if (!hasLevel(resolveAccess(assignments, livePermissionMap(roles), []).global.access, 'manage')) {
    throw appError(
      'CONFLICT',
      'Anda tidak dapat menghilangkan akses Kelola Pengaturan Akses milik sendiri',
    );
  }
}

/** Admin non-super tidak boleh mengubah role hingga akses Kelola global miliknya sendiri hilang. */
function assertRoleEditKeepsOwnAccess(
  updated: RoleRecord,
  roles: readonly RoleRecord[],
  users: readonly UserRecord[],
  actor: UserContext,
): void {
  if (actor.isSuperAdmin || actor.userId === null) return;
  if (!hasLevel(actor.permissions.access, 'manage')) return;
  const self = users.find((user) => user.id === actor.userId);
  if (!self) return;
  const rolePermissions = new Map(
    roles
      .filter(isLiveRecord)
      .map(
        (role) =>
          [role.id, role.id === updated.id ? updated.permissions : role.permissions] as const,
      ),
  );
  if (!hasLevel(resolveAccess(self.assignments, rolePermissions, []).global.access, 'manage')) {
    throw appError(
      'CONFLICT',
      'Anda tidak dapat menghilangkan akses Kelola Pengaturan Akses milik sendiri',
    );
  }
}

const USER_CONFLICTS = { users_email: { field: 'email', message: 'Email sudah terdaftar' } };
const ROLE_CONFLICTS = {
  roles_name_unique: { field: 'name', message: 'Nama role sudah dipakai' },
};

/**
 * Simpan user. Perubahan dan audit satu `batch()` (atomik). Pencabutan akses berlaku pada permintaan
 * berikutnya karena konteks akses dimuat per permintaan (tanpa cache).
 */
export async function saveUser(
  env: Env,
  input: SaveUserInput,
  actor: UserContext,
): Promise<UserDto> {
  const email = normalizeEmail(input.email);
  const { users, roles, locations, businessUnits } = await loadAccessTables(env);
  const existing = input.id ? users.find((user) => user.id === input.id) : undefined;
  if (input.id && (!existing || !isLiveRecord(existing))) {
    throw appError('NOT_FOUND', 'User tidak ditemukan');
  }
  assertAssignmentsValid(input.assignments, roles, locations, existing);
  assertBuAssignmentsValid(input.buAssignments, roles, businessUnits, existing);
  // Email unik penuh: pengguna TERHAPUS tetap memegang emailnya (pulihkan akun lama; keputusan pemilik soft delete 10).
  if (users.some((user) => user.email === email && user.id !== input.id)) {
    throw appError('CONFLICT', 'Email sudah terdaftar', { email: 'Email sudah terdaftar' });
  }
  // Super admin (ADMIN_EMAIL) tidak dapat dinonaktifkan, sama pola dengan larangan hapus (keputusan pemilik 2026-11-21).
  if (input.status === 'inactive' && isSuperAdminEmail(env, email)) {
    throw appError('CONFLICT', SUPER_ADMIN_INACTIVE_MESSAGE, {
      status: SUPER_ADMIN_INACTIVE_MESSAGE,
    });
  }
  const now = nowIso(env);
  const assignments = input.assignments.map((entry) => ({
    ...entry,
    roleIds: [...entry.roleIds],
  }));
  const buAssignments = input.buAssignments.map((entry) => ({
    ...entry,
    roleIds: [...entry.roleIds],
  }));

  if (existing) {
    if (existing.email !== email) {
      throw appError('VALIDATION', 'Email tidak dapat diubah', {
        email: 'Email tidak dapat diubah',
      });
    }
    if (existing.email === actor.email && input.status === 'inactive') {
      throw appError('CONFLICT', 'Anda tidak bisa menonaktifkan akun sendiri');
    }
    assertKeepsOwnAccess(input.assignments, roles, existing, actor);
    const updated: UserRecord = {
      ...existing,
      name: input.name,
      status: input.status,
      assignments,
      buAssignments,
      // Tak dikirim = pertahankan nilai yang ada.
      sharedAccount: input.sharedAccount ?? existing.sharedAccount,
      updatedAt: now,
      updatedBy: actor.email,
    };
    await batchWrite(
      env.DB,
      [
        updateUserStmt(env.DB, updated),
        writeAudit(env.DB, {
          ts: now,
          actor: actor.email,
          action: 'user.update',
          target: email,
          targetId: updated.id,
          before: userSnapshot(existing, businessUnits),
          after: userSnapshot(updated, businessUnits),
        }),
      ],
      USER_CONFLICTS,
    );
    return toUserDto(env, updated, roles);
  }

  const created: UserRecord = {
    id: crypto.randomUUID(),
    email,
    name: input.name,
    status: input.status,
    assignments,
    buAssignments,
    sharedAccount: input.sharedAccount ?? false,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
    deletedAt: '',
    deletedBy: '',
  };
  await batchWrite(
    env.DB,
    [
      insertUserStmt(env.DB, created),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'user.create',
        target: email,
        targetId: created.id,
        before: null,
        after: userSnapshot(created, businessUnits),
      }),
    ],
    USER_CONFLICTS,
  );
  return toUserDto(env, created, roles);
}

const USER_STALE = 'Pengguna diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';
const USER_NOT_FOUND = 'User tidak ditemukan';

function userSpec(env: Env, tables: AccessTables): LifecycleSpec<UserRecord, UserDto> {
  return {
    table: 'users',
    audit: 'user',
    noun: 'pengguna',
    auditTarget: (user) => user.email,
    snapshot: (user) => userSnapshot(user, tables.businessUnits),
    toDto: (user) => toUserDto(env, user, tables.roles),
  };
}

function findUser(tables: AccessTables, id: string): UserRecord {
  const user = tables.users.find((record) => record.id === id);
  if (!user) throw appError('NOT_FOUND', USER_NOT_FOUND);
  return user;
}

const SUPER_ADMIN_INACTIVE_MESSAGE = 'Akun super admin tidak dapat dinonaktifkan';

/** Super admin = alamat `ADMIN_EMAIL` (identitasnya dari env, bukan dari baris pengguna): tak boleh dihapus maupun dinonaktifkan. */
function isSuperAdminEmail(env: Env, email: string): boolean {
  const admin = normalizeEmail(env.ADMIN_EMAIL ?? '');
  return admin !== '' && email === admin;
}

function userPlanners(env: Env, actor: UserContext) {
  const cache = createAccessTablesCache(env);
  const options = { conflicts: USER_CONFLICTS, stale: USER_STALE, prepare: cache.reset };
  return {
    options,
    status:
      (status: 'active' | 'inactive') =>
      async (id: string): Promise<PlanOutcome<UserDto>> => {
        const tables = await cache.get();
        const user = findUser(tables, id);
        if (!isLiveRecord(user)) throw appError('NOT_FOUND', USER_NOT_FOUND);
        if (user.email === actor.email && status === 'inactive') {
          throw appError('CONFLICT', 'Anda tidak bisa menonaktifkan akun sendiri');
        }
        if (status === 'inactive' && isSuperAdminEmail(env, user.email)) {
          throw appError('CONFLICT', SUPER_ADMIN_INACTIVE_MESSAGE);
        }
        return planStatusChange(env, userSpec(env, tables), user, status, actor);
      },
    remove: async (id: string): Promise<PlanOutcome<RemoveResult>> => {
      const tables = await cache.get();
      const user = findUser(tables, id);
      if (isLiveRecord(user)) {
        if (user.email === actor.email) {
          throw appError('CONFLICT', 'Anda tidak bisa menghapus akun sendiri');
        }
        if (isSuperAdminEmail(env, user.email)) {
          throw appError('CONFLICT', 'Akun super admin tidak dapat dihapus');
        }
      }
      return planSoftDelete(env, userSpec(env, tables), user, actor);
    },
    restore: async (id: string): Promise<PlanOutcome<UserDto>> => {
      const tables = await cache.get();
      return planRestore(env, userSpec(env, tables), findUser(tables, id), actor);
    },
  };
}

/** Ubah status satu pengguna: perencana yang sama dengan batch (tunggal = batch berisi satu id). */
export function setUserStatus(
  env: Env,
  input: SetUserStatusInput,
  actor: UserContext,
): Promise<UserDto> {
  const planners = userPlanners(env, actor);
  return runSingleRecord(env, input.id, planners.status(input.status), planners.options);
}

export function setUserStatusBatch(
  env: Env,
  input: StatusBatchInput,
  actor: UserContext,
): Promise<BatchResult<UserDto>> {
  const planners = userPlanners(env, actor);
  return runRecordBatch(env, input.ids, planners.status(input.status), planners.options);
}

export function removeUser(
  env: Env,
  input: GetUserInput,
  actor: UserContext,
): Promise<RemoveResult> {
  const planners = userPlanners(env, actor);
  return runSingleRecord(env, input.id, planners.remove, planners.options);
}

export async function removeUserBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<RemoveBatchResult> {
  const planners = userPlanners(env, actor);
  const { items } = await runRecordBatch(env, input.ids, planners.remove, planners.options);
  return { ids: items.map((item) => item.id) };
}

export function restoreUser(env: Env, input: GetUserInput, actor: UserContext): Promise<UserDto> {
  const planners = userPlanners(env, actor);
  return runSingleRecord(env, input.id, planners.restore, planners.options);
}

export function restoreUserBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<BatchResult<UserDto>> {
  const planners = userPlanners(env, actor);
  return runRecordBatch(env, input.ids, planners.restore, planners.options);
}

export async function saveRole(
  env: Env,
  input: SaveRoleInput,
  actor: UserContext,
): Promise<RoleDto> {
  const { users, roles } = await loadAccessTables(env);
  const nameKey = input.name.trim().toLowerCase();
  // Nama unik antar role HIDUP (role terhapus tak menahan namanya; pemulihan memeriksa ulang).
  if (
    roles.some(
      (role) =>
        isLiveRecord(role) && role.name.trim().toLowerCase() === nameKey && role.id !== input.id,
    )
  ) {
    throw appError('CONFLICT', 'Nama role sudah dipakai', { name: 'Nama role sudah dipakai' });
  }
  const permissions = sanitizePermissions(input.permissions);
  const now = nowIso(env);

  if (input.id) {
    const existing = roles.find((role) => role.id === input.id);
    if (!existing || !isLiveRecord(existing)) throw appError('NOT_FOUND', 'Role tidak ditemukan');
    const updated: RoleRecord = {
      ...existing,
      name: input.name,
      description: input.description,
      permissions,
      updatedAt: now,
      updatedBy: actor.email,
    };
    assertRoleEditKeepsOwnAccess(updated, roles, users, actor);
    await batchWrite(
      env.DB,
      [
        updateRoleStmt(env.DB, updated),
        writeAudit(env.DB, {
          ts: now,
          actor: actor.email,
          action: 'role.update',
          target: updated.name,
          targetId: updated.id,
          before: roleSnapshot(existing),
          after: roleSnapshot(updated),
        }),
      ],
      ROLE_CONFLICTS,
    );
    return toRoleDto(updated, users);
  }

  const created: RoleRecord = {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    permissions,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
    deletedAt: '',
    deletedBy: '',
  };
  await batchWrite(
    env.DB,
    [
      insertRoleStmt(env.DB, created),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'role.create',
        target: created.name,
        targetId: created.id,
        before: null,
        after: roleSnapshot(created),
      }),
    ],
    ROLE_CONFLICTS,
  );
  return toRoleDto(created, users);
}

const ROLE_STALE = 'Role diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';
const ROLE_NOT_FOUND = 'Role tidak ditemukan';
const ROLE_NAME_TAKEN = 'Nama role sudah dipakai';

function roleSpec(tables: AccessTables): LifecycleSpec<RoleRecord, RoleDto> {
  return {
    table: 'roles',
    audit: 'role',
    noun: 'role',
    auditTarget: (role) => role.name,
    snapshot: roleSnapshot,
    toDto: (role) => toRoleDto(role, tables.users),
  };
}

function rolePlanners(env: Env, actor: UserContext) {
  const cache = createAccessTablesCache(env);
  const options = { conflicts: ROLE_CONFLICTS, stale: ROLE_STALE, prepare: cache.reset };
  /** Dua role terhapus bernama sama dipulihkan sekaligus: nama bentrok antar record satu permintaan. */
  const restoreOptions = {
    ...options,
    verify: (restored: RoleDto[]) => {
      const seen = new Set<string>();
      for (const role of restored) {
        const key = role.name.trim().toLowerCase();
        if (seen.has(key)) throw appError('CONFLICT', ROLE_NAME_TAKEN, { name: ROLE_NAME_TAKEN });
        seen.add(key);
      }
    },
  };
  const find = (tables: AccessTables, id: string): RoleRecord => {
    const role = tables.roles.find((record) => record.id === id);
    if (!role) throw appError('NOT_FOUND', ROLE_NOT_FOUND);
    return role;
  };
  return {
    options,
    restoreOptions,
    /** Hapus: bebas status (role tak punya), tetapi hanya bila tak dipakai PENGGUNA HIDUP mana pun. */
    remove: async (id: string): Promise<PlanOutcome<RemoveResult>> => {
      const tables = await cache.get();
      const role = find(tables, id);
      if (isLiveRecord(role)) {
        const usage = liveUsageOf(tables.users, role.id);
        if (usage > 0) throw appError('CONFLICT', `Role masih dipakai oleh ${usage} user`);
      }
      return planSoftDelete(env, roleSpec(tables), role, actor, false);
    },
    restore: async (id: string): Promise<PlanOutcome<RoleDto>> => {
      const tables = await cache.get();
      const role = find(tables, id);
      if (!isLiveRecord(role)) {
        const key = role.name.trim().toLowerCase();
        if (
          tables.roles.some(
            (other) =>
              isLiveRecord(other) &&
              other.id !== role.id &&
              other.name.trim().toLowerCase() === key,
          )
        ) {
          throw appError('CONFLICT', ROLE_NAME_TAKEN, { name: ROLE_NAME_TAKEN });
        }
      }
      return planRestore(env, roleSpec(tables), role, actor, false);
    },
  };
}

/** Hapus lunak satu role (rute `access.roles.delete`, bentuk keluaran tetap `{ id }`). */
export function removeRole(
  env: Env,
  input: DeleteRoleInput,
  actor: UserContext,
): Promise<RemoveResult> {
  const planners = rolePlanners(env, actor);
  return runSingleRecord(env, input.id, planners.remove, planners.options);
}

export async function removeRoleBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<RemoveBatchResult> {
  const planners = rolePlanners(env, actor);
  const { items } = await runRecordBatch(env, input.ids, planners.remove, planners.options);
  return { ids: items.map((item) => item.id) };
}

export function restoreRole(env: Env, input: GetRoleInput, actor: UserContext): Promise<RoleDto> {
  const planners = rolePlanners(env, actor);
  return runSingleRecord(env, input.id, planners.restore, planners.restoreOptions);
}

export function restoreRoleBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<BatchResult<RoleDto>> {
  const planners = rolePlanners(env, actor);
  return runRecordBatch(env, input.ids, planners.restore, planners.restoreOptions);
}
