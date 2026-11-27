import { ALL_LOCATIONS_KEY } from '@shared/assignments';
import { ALL_BU_KEY, formatBuLabel } from '@shared/business-units';
import type {
  BusinessUnitDto,
  BusinessUnitOptionDto,
  LocationDto,
  RoleDto,
  SaveBusinessUnitInput,
  SaveLocationInput,
  SaveRoleInput,
} from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { useForm, useStore } from '@tanstack/react-form';
import { useEffect, useRef, useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { FieldError } from '@/components/field-error';
import { LinkField, LinkMultiField, type LinkOption } from '@/components/link-field';
import { type FormTab, FormTabs } from '@/components/page/form-tabs';
import { Select } from '@/components/select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type DeletedNames, makeAssignmentLabels } from '../lib/assignment-labels';
import type { UserFormInput, UserFormOutput } from '../schemas';
import { userFormSchema } from '../schemas';
import { BusinessUnitFormDialog } from './business-unit-form-dialog';
import { LocationFormDialog } from './location-form-dialog';
import { RoleFormDialog } from './role-form-dialog';

export type UserFormTab = 'identity' | 'locations' | 'businessUnits';

const TAB_LABELS: Record<UserFormTab, string> = {
  identity: 'Identitas',
  locations: 'Penugasan lokasi',
  businessUnits: 'Penugasan BU',
};

export interface UserFormProps {
  /** Id elemen `<form>`: tombol Simpan ada di luar form (footer dialog) dan memakai `form={formId}`. */
  formId: string;
  mode: 'create' | 'edit';
  /**
   * Alasan status "Nonaktif" tak dapat dipilih (akun sendiri atau super admin); kosong = bebas. Hanya untuk UX:
   * server menolak penonaktifan akun sendiri.
   */
  statusLockReason?: string | undefined;
  defaultValues: UserFormInput;
  /** Role, lokasi, dan BU HIDUP (pilihan); yang terhapus hanya tampil bila sudah melekat pada penugasan. */
  roles: readonly RoleDto[];
  locations: readonly LocationDto[];
  businessUnits: readonly BusinessUnitOptionDto[];
  /** Nama record terhapus (hanya diketahui `access: manage`); tanpa ini tampil nama umum + "Terhapus". */
  deletedNames?: DeletedNames | undefined;
  /** Tautan ke halaman lihat (tab baru); tidak disediakan bila user tak berhak melihatnya, sehingga tombolnya hilang. */
  openBusinessUnitHref?: ((id: string) => string | null) | undefined;
  openLocationHref?: ((id: string) => string | null) | undefined;
  openRoleHref?: ((id: string) => string | null) | undefined;
  /** Baris "Tambah ..." pada field relasi (hanya untuk `access: manage`); record baru langsung terpilih. */
  onCreateLocation?: ((input: SaveLocationInput) => Promise<LocationDto>) | undefined;
  onCreateRole?: ((input: SaveRoleInput) => Promise<RoleDto>) | undefined;
  onCreateBusinessUnit?: ((input: SaveBusinessUnitInput) => Promise<BusinessUnitDto>) | undefined;
  submitError?: string | null;
  /** Galat per field dari server (mis. email sudah terdaftar); membuka tab Identitas. */
  fieldErrors?: { email?: string; name?: string };
  onSubmit: (values: UserFormOutput) => Promise<unknown>;
  /** Proses simpan berjalan atau tidak (untuk tombol Simpan di luar form). */
  onBusyChange?: (busy: boolean) => void;
}

/** Saring opsi daftar kecil yang sudah dimuat penuh menurut teks pencarian (label, tanpa peka huruf besar/kecil). */
function filterByTerm<T>(items: readonly T[], term: string, labelOf: (item: T) => string): T[] {
  const key = normalizeKey(term);
  return key === ''
    ? [...items]
    : items.filter((item) => normalizeKey(labelOf(item)).includes(key));
}

interface AssignmentOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** `LinkField` satu pilihan untuk baris penugasan: opsi dimuat penuh, pencarian menyaring lokal. */
function AssignmentField({
  id,
  label,
  placeholder,
  value,
  options,
  onChange,
  openHref,
  onCreate,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  options: readonly AssignmentOption[];
  onChange: (value: string) => void;
  openHref?: ((id: string) => string | null) | undefined;
  onCreate?: (() => void) | undefined;
}) {
  const [term, setTerm] = useState('');
  return (
    <LinkField
      id={id}
      label={label}
      placeholder={placeholder}
      value={value === '' ? null : value}
      labelOf={(selected) => options.find((option) => option.value === selected)?.label}
      options={filterByTerm(options, term, (option) => option.label).map(
        (option): LinkOption => ({
          id: option.value,
          label: option.label,
          ...(option.disabled ? { disabled: true } : {}),
        }),
      )}
      onSearchChange={setTerm}
      searchDebounceMs={0}
      onChange={(next) => onChange(next ?? '')}
      openHref={openHref}
      onCreate={onCreate}
    />
  );
}

/** `LinkMultiField` role untuk baris penugasan: role dipilih sebagai chip; opsi menyaring lokal. */
function RoleAssignmentField({
  id,
  label,
  roles,
  roleLabel,
  value,
  onChange,
  openHref,
  onCreate,
}: {
  id: string;
  label: string;
  roles: readonly RoleDto[];
  roleLabel: (id: string) => string;
  value: readonly string[];
  onChange: (roleIds: string[]) => void;
  openHref?: ((id: string) => string | null) | undefined;
  onCreate?: (() => void) | undefined;
}) {
  const [term, setTerm] = useState('');
  return (
    <div className="space-y-1.5">
      <LinkMultiField
        id={id}
        label={label}
        placeholder="Pilih role…"
        value={value}
        labelOf={roleLabel}
        options={filterByTerm(roles, term, (role) => role.name).map((role) => ({
          id: role.id,
          label: role.name,
        }))}
        onSearchChange={setTerm}
        searchDebounceMs={0}
        onChange={onChange}
        openHref={openHref}
        onCreate={onCreate}
      />
      {roles.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada role.</p> : null}
    </div>
  );
}

/** Dialog "Tambah ..." yang sedang terbuka: jenisnya, bagian penugasan, dan baris yang menerima hasilnya. */
type CreateTarget =
  | { kind: 'location'; row: number }
  | { kind: 'businessUnit'; row: number }
  | { kind: 'role'; section: 'assignments' | 'buAssignments'; row: number };

function tabErrorKey(state: { fieldMeta: Record<string, { errors: unknown[] } | undefined> }) {
  const has = (...names: string[]) =>
    names.some((name) => (state.fieldMeta[name]?.errors.length ?? 0) > 0);
  return `${has('email', 'name', 'status', 'sharedAccount') ? 1 : 0}${has('assignments') ? 1 : 0}${has('buAssignments') ? 1 : 0}`;
}

export function UserForm({
  formId,
  mode,
  statusLockReason,
  defaultValues,
  roles,
  locations,
  businessUnits,
  deletedNames,
  openBusinessUnitHref,
  openLocationHref,
  openRoleHref,
  onCreateLocation,
  onCreateRole,
  onCreateBusinessUnit,
  submitError,
  fieldErrors,
  onSubmit,
  onBusyChange,
}: UserFormProps) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: userFormSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(userFormSchema.parse(value));
    },
  });
  useUnsavedChanges(useStore(form.store, (state) => state.isDirty && !state.isSubmitSuccessful));
  const submitting = useStore(form.store, (state) => state.isSubmitting);
  useEffect(() => onBusyChange?.(submitting), [submitting, onBusyChange]);

  // Record yang baru dibuat lewat dialog "Tambah" langsung dapat dipilih/dilabeli, sebelum daftar server dimuat ulang.
  const [createdLocations, setCreatedLocations] = useState<readonly LocationDto[]>([]);
  const [createdRoles, setCreatedRoles] = useState<readonly RoleDto[]>([]);
  const [createdBus, setCreatedBus] = useState<readonly BusinessUnitDto[]>([]);
  const [creating, setCreating] = useState<CreateTarget | null>(null);
  const lastTarget = useRef<CreateTarget | null>(null);
  if (creating) lastTarget.current = creating;

  const allLocations = [
    ...locations,
    ...createdLocations.filter((created) => !locations.some((l) => l.id === created.id)),
  ];
  const allRoles = [
    ...roles,
    ...createdRoles.filter((created) => !roles.some((r) => r.id === created.id)),
  ];
  const liveBusinessUnits: readonly BusinessUnitOptionDto[] = [
    ...businessUnits.filter((bu) => !bu.deleted),
    ...createdBus.filter((created) => !businessUnits.some((b) => b.id === created.id)),
  ];
  const labels = makeAssignmentLabels({
    roles: allRoles,
    locations: allLocations,
    businessUnits: liveBusinessUnits,
    deleted: deletedNames,
  });
  const roleLabel = (id: string) => {
    const named = labels.role(id);
    return named.deleted ? `${named.name} (Terhapus)` : named.name;
  };

  // Tab: terkendali agar submit gagal dapat membuka tab bergalat pertama (sekali per percobaan simpan).
  const [tab, setTab] = useState<UserFormTab>('identity');
  const attempts = useStore(form.store, (state) => state.submissionAttempts);
  const errorKey = useStore(form.store, (state) => tabErrorKey(state));
  const serverIdentityError = Boolean(fieldErrors?.email || fieldErrors?.name);
  const tabErrors: Record<UserFormTab, boolean> = {
    identity: errorKey[0] === '1' || serverIdentityError,
    locations: errorKey[1] === '1',
    businessUnits: errorKey[2] === '1',
  };
  const handledAttempt = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: dibuka sekali per percobaan simpan, bukan tiap galat berubah
  useEffect(() => {
    if (attempts <= handledAttempt.current) return;
    const first = (Object.keys(TAB_LABELS) as UserFormTab[]).find((id) => tabErrors[id]);
    if (first) {
      handledAttempt.current = attempts;
      setTab(first);
    }
  }, [attempts, errorKey]);
  // Galat dari server (email sudah terdaftar, dst.): buka tab Identitas.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fieldErrors` sengaja jadi pemicu agar galat server baru membuka tab lagi
  useEffect(() => {
    if (serverIdentityError) setTab('identity');
  }, [serverIdentityError, fieldErrors]);

  function addCreatedRole(created: RoleDto, target: Extract<CreateTarget, { kind: 'role' }>) {
    setCreatedRoles((previous) => [...previous, created]);
    const withRole = <T extends { roleIds: string[] }>(rows: T[]): T[] =>
      rows.map((row, i) =>
        i === target.row ? { ...row, roleIds: [...row.roleIds, created.id] } : row,
      );
    if (target.section === 'assignments') form.setFieldValue('assignments', withRole);
    else form.setFieldValue('buAssignments', withRole);
  }

  const tabs: FormTab[] = [
    {
      id: 'identity',
      label: TAB_LABELS.identity,
      hasError: tabErrors.identity,
      content: (
        <div className="space-y-4">
          <form.Field name="email">
            {(field) => (
              <div className="space-y-1.5">
                <Label htmlFor="user-email" required>
                  Email
                </Label>
                <Input
                  id="user-email"
                  aria-required="true"
                  type="email"
                  value={field.state.value}
                  disabled={mode === 'edit'}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldError errors={[...field.state.meta.errors, fieldErrors?.email]} />
              </div>
            )}
          </form.Field>
          <form.Field name="name">
            {(field) => (
              <div className="space-y-1.5">
                <Label htmlFor="user-name" required>
                  Nama
                </Label>
                <Input
                  id="user-name"
                  aria-required="true"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldError errors={[...field.state.meta.errors, fieldErrors?.name]} />
              </div>
            )}
          </form.Field>
          <form.Field name="status">
            {(field) => (
              <div className="space-y-1">
                <Select
                  id="user-status"
                  label="Status"
                  options={[
                    { value: 'active', label: 'Aktif' },
                    {
                      value: 'inactive',
                      label: 'Nonaktif',
                      disabled: statusLockReason !== undefined && field.state.value === 'active',
                    },
                  ]}
                  value={field.state.value}
                  onValueChange={(next) => field.handleChange(next as UserFormInput['status'])}
                />
                {statusLockReason !== undefined && field.state.value === 'active' ? (
                  <p className="text-xs text-muted-foreground">{statusLockReason}</p>
                ) : null}
              </div>
            )}
          </form.Field>
          <form.Field name="sharedAccount">
            {(field) => (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="user-shared-account"
                    checked={field.state.value}
                    aria-describedby="user-shared-account-hint"
                    onCheckedChange={(next) => field.handleChange(next === true)}
                  />
                  <Label htmlFor="user-shared-account" className="font-normal">
                    Akun bersama
                  </Label>
                </div>
                <p id="user-shared-account-hint" className="text-xs text-muted-foreground">
                  Dipakai beberapa orang. Panduan ditampilkan ulang di tiap perangkat.
                </p>
              </div>
            )}
          </form.Field>
        </div>
      ),
    },
    {
      id: 'locations',
      label: TAB_LABELS.locations,
      hasError: tabErrors.locations,
      content: (
        <form.Field name="assignments">
          {(field) => {
            const rows = field.state.value;
            const used = new Set(rows.map((row) => row.locationId));
            const update = (index: number, patch: Partial<(typeof rows)[number]>) =>
              field.handleChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
            const optionsFor = (current: string): AssignmentOption[] => [
              ...(used.has(ALL_LOCATIONS_KEY) && current !== ALL_LOCATIONS_KEY
                ? []
                : [{ value: ALL_LOCATIONS_KEY, label: 'Semua lokasi' }]),
              ...allLocations
                .filter(
                  (location) =>
                    (location.status === 'active' || location.id === current) &&
                    (!used.has(location.id) || location.id === current),
                )
                .map((location) => ({
                  value: location.id,
                  label:
                    location.status === 'active'
                      ? `${location.name} (${location.code})`
                      : `${location.name} (${location.code}) — nonaktif`,
                })),
              // Lokasi terhapus yang masih tertaut: tampil bertanda, tidak dapat dipilih ulang, tetap terkirim.
              ...(current !== '' &&
              current !== ALL_LOCATIONS_KEY &&
              !allLocations.some((location) => location.id === current)
                ? [
                    {
                      value: current,
                      label: `${labels.location(current).name} (Terhapus)`,
                      disabled: true,
                    },
                  ]
                : []),
            ];
            return (
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">Penugasan lokasi</legend>
                <p className="text-xs text-muted-foreground">
                  Hak di tiap lokasi ditentukan oleh role penugasannya. Pengaturan Akses hanya
                  berlaku dari penugasan Semua lokasi.
                </p>
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada penugasan.</p>
                ) : null}
                {rows.map((row, index) => (
                  <fieldset
                    // biome-ignore lint/suspicious/noArrayIndexKey: baris penugasan tidak punya id stabil
                    key={index}
                    aria-label={`Penugasan ${index + 1}`}
                    className="space-y-2 rounded-lg border p-3"
                  >
                    <div className="flex items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <AssignmentField
                          id={`assign-location-${index}`}
                          label={`Lokasi penugasan ${index + 1}`}
                          placeholder="Pilih lokasi…"
                          value={row.locationId}
                          options={optionsFor(row.locationId)}
                          onChange={(locationId) => update(index, { locationId })}
                          openHref={
                            openLocationHref
                              ? (id) => (id === ALL_LOCATIONS_KEY ? null : openLocationHref(id))
                              : undefined
                          }
                          onCreate={
                            onCreateLocation
                              ? () => setCreating({ kind: 'location', row: index })
                              : undefined
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        color="primary"
                        size="sm"
                        aria-label={`Hapus penugasan ${index + 1}`}
                        onClick={() => field.handleChange(rows.filter((_, i) => i !== index))}
                      >
                        Hapus
                      </Button>
                    </div>
                    <RoleAssignmentField
                      id={`assign-roles-${index}`}
                      label={`Role penugasan ${index + 1}`}
                      roles={allRoles}
                      roleLabel={roleLabel}
                      value={row.roleIds}
                      onChange={(roleIds) => update(index, { roleIds })}
                      openHref={openRoleHref}
                      onCreate={
                        onCreateRole
                          ? () => setCreating({ kind: 'role', section: 'assignments', row: index })
                          : undefined
                      }
                    />
                  </fieldset>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  color="primary"
                  size="sm"
                  onClick={() => field.handleChange([...rows, { locationId: '', roleIds: [] }])}
                >
                  Tambah penugasan
                </Button>
                <FieldError stacked errors={field.state.meta.errors} />
              </fieldset>
            );
          }}
        </form.Field>
      ),
    },
    {
      id: 'businessUnits',
      label: TAB_LABELS.businessUnits,
      hasError: tabErrors.businessUnits,
      content: (
        <form.Field name="buAssignments">
          {(field) => {
            const rows = field.state.value;
            const used = new Set(rows.map((row) => row.buId));
            const update = (index: number, patch: Partial<(typeof rows)[number]>) =>
              field.handleChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
            const optionsFor = (current: string): AssignmentOption[] => [
              ...(used.has(ALL_BU_KEY) && current !== ALL_BU_KEY
                ? []
                : [{ value: ALL_BU_KEY, label: 'Semua BU' }]),
              ...liveBusinessUnits
                .filter(
                  (unit) =>
                    (unit.status === 'active' || unit.id === current) &&
                    (!used.has(unit.id) || unit.id === current),
                )
                .map((unit) => ({
                  value: unit.id,
                  label:
                    unit.status === 'active'
                      ? formatBuLabel(unit)
                      : `${formatBuLabel(unit)} — nonaktif`,
                })),
              // BU terhapus yang masih tertaut tetap memberi hak: tampil bertanda dan idnya tetap terkirim.
              ...(current !== '' &&
              current !== ALL_BU_KEY &&
              !liveBusinessUnits.some((unit) => unit.id === current)
                ? [
                    {
                      value: current,
                      label: `${labels.businessUnit(current).name} (Terhapus)`,
                      disabled: true,
                    },
                  ]
                : []),
            ];
            return (
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">Penugasan BU</legend>
                <p className="text-xs text-muted-foreground">
                  Hak BU berlaku sama di semua lokasi; hanya modul ber-BU (Data Item) yang dibaca
                  dari role di sini. User tanpa penugasan BU tidak melihat item apa pun.
                </p>
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada penugasan BU.</p>
                ) : null}
                {rows.map((row, index) => (
                  <fieldset
                    // biome-ignore lint/suspicious/noArrayIndexKey: baris penugasan tidak punya id stabil
                    key={index}
                    aria-label={`Penugasan BU ${index + 1}`}
                    className="space-y-2 rounded-lg border p-3"
                  >
                    <div className="flex items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <AssignmentField
                          id={`assign-bu-${index}`}
                          label={`BU penugasan ${index + 1}`}
                          placeholder="Pilih BU…"
                          value={row.buId}
                          options={optionsFor(row.buId)}
                          onChange={(buId) => update(index, { buId })}
                          openHref={
                            openBusinessUnitHref
                              ? (id) => (id === ALL_BU_KEY ? null : openBusinessUnitHref(id))
                              : undefined
                          }
                          onCreate={
                            onCreateBusinessUnit
                              ? () => setCreating({ kind: 'businessUnit', row: index })
                              : undefined
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        color="primary"
                        size="sm"
                        aria-label={`Hapus penugasan BU ${index + 1}`}
                        onClick={() => field.handleChange(rows.filter((_, i) => i !== index))}
                      >
                        Hapus
                      </Button>
                    </div>
                    <RoleAssignmentField
                      id={`bu-assign-roles-${index}`}
                      label={`Role penugasan BU ${index + 1}`}
                      roles={allRoles}
                      roleLabel={roleLabel}
                      value={row.roleIds}
                      onChange={(roleIds) => update(index, { roleIds })}
                      openHref={openRoleHref}
                      onCreate={
                        onCreateRole
                          ? () =>
                              setCreating({ kind: 'role', section: 'buAssignments', row: index })
                          : undefined
                      }
                    />
                  </fieldset>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  color="primary"
                  size="sm"
                  onClick={() => field.handleChange([...rows, { buId: '', roleIds: [] }])}
                >
                  Tambah penugasan BU
                </Button>
                <FieldError stacked errors={field.state.meta.errors} />
              </fieldset>
            );
          }}
        </form.Field>
      ),
    },
  ];

  const target = lastTarget.current;
  return (
    <>
      <form
        id={formId}
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          // Dialog ini dapat dibuka dari dalam form lain: submit tidak boleh menjalar.
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        {submitError ? (
          <p role="alert" className="text-sm text-destructive-text">
            {submitError}
          </p>
        ) : null}
        <FormTabs tabs={tabs} value={tab} onValueChange={(id) => setTab(id as UserFormTab)} />
        {/* Penerima Enter di kolom isian: tombol Simpan sebenarnya ada di footer dialog (di luar form). */}
        <button type="submit" hidden tabIndex={-1} aria-hidden />
      </form>
      {/* Dialog "Tambah" di luar <form>: event submit dari portalnya tidak menjalar ke form pengguna. */}
      {onCreateLocation ? (
        <LocationFormDialog
          open={creating?.kind === 'location'}
          onOpenChange={(open) => (open ? undefined : setCreating(null))}
          onSave={async (input) => {
            const created = await onCreateLocation(input);
            setCreatedLocations((previous) => [...previous, created]);
            if (target?.kind === 'location') {
              form.setFieldValue('assignments', (rows) =>
                rows.map((row, i) => (i === target.row ? { ...row, locationId: created.id } : row)),
              );
            }
            return created;
          }}
        />
      ) : null}
      {onCreateBusinessUnit ? (
        <BusinessUnitFormDialog
          open={creating?.kind === 'businessUnit'}
          onOpenChange={(open) => (open ? undefined : setCreating(null))}
          onSave={async (input) => {
            const created = await onCreateBusinessUnit(input);
            setCreatedBus((previous) => [...previous, created]);
            if (target?.kind === 'businessUnit') {
              form.setFieldValue('buAssignments', (rows) =>
                rows.map((row, i) => (i === target.row ? { ...row, buId: created.id } : row)),
              );
            }
            return created;
          }}
        />
      ) : null}
      {onCreateRole ? (
        <RoleFormDialog
          open={creating?.kind === 'role'}
          onOpenChange={(open) => (open ? undefined : setCreating(null))}
          onSave={async (input) => {
            const created = await onCreateRole(input);
            if (target?.kind === 'role') addCreatedRole(created, target);
            return created;
          }}
        />
      ) : null}
    </>
  );
}
