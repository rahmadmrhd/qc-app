import type { StickerTypeDto } from '@shared/contract';
import { STICKER_LIMITS, type StickerRule, USER_STICKER_RULES } from '@shared/stickers';
import { useEffect, useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { Select } from '@/components/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { describeError } from '@/lib/api/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { isStaleSaveError, STALE_SAVE_MESSAGE } from '../lib/stale';
import { STICKER_RULE_HINT, STICKER_RULE_LABEL, stickerTypeFormSchema } from '../schemas';

export interface StickerTypeSaveInput {
  id?: string;
  /** Versi yang dilihat saat form dibuka; wajib saat ubah, tidak dikirim saat membuat. */
  expectedUpdatedAt?: string;
  name: string;
  rule: StickerRule;
  /** Hanya dikirim bila pengguna boleh mengubahnya (`sticker: manage`) dan nilainya berubah/baru. */
  defaultMinQty?: number;
}

/** Galat simpan: pesan umum dan, bila server menyebut field, pesan khusus field itu. */
export interface StickerTypeSaveFailure {
  message: string;
  name?: string;
  rule?: string;
  defaultMinQty?: string;
}

export type StickerTypeSaveResult = string | StickerTypeSaveFailure | null;

/** Mengubah galat API menjadi hasil simpan dialog (dipakai pemanggil yang memanggil API jenis stiker). */
export function stickerTypeSaveFailure(error: unknown): StickerTypeSaveFailure {
  if (isStaleSaveError(error)) return { message: STALE_SAVE_MESSAGE };
  const fields = pickFieldErrors(error, ['name', 'rule', 'defaultMinQty'] as const);
  return { message: describeError(error), ...fields };
}

export interface StickerTypeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Jenis yang diubah; kosong = jenis baru. */
  type?: Pick<StickerTypeDto, 'id' | 'name' | 'rule' | 'stickerCount' | 'updatedAt'> &
    Partial<Pick<StickerTypeDto, 'defaultMinQty' | 'systemKind'>>;
  /**
   * Boleh mengubah minimum stok bawaan (`sticker: manage`, sama dengan Konfigurasi Stiker). Tanpa ini kolomnya hanya
   * tampil dan tidak dikirim.
   */
  canSetDefaultMin?: boolean;
  /** `null` = berhasil (dialog menutup sendiri); string/objek = galat yang tampil di dialog. */
  onSave: (input: StickerTypeSaveInput) => Promise<StickerTypeSaveResult>;
}

export interface StickerTypeFormProps {
  /** Id elemen `<form>`: tombol Simpan ada di luar form (footer dialog) dan memakai `form={formId}`. */
  formId: string;
  type?: StickerTypeFormDialogProps['type'];
  canSetDefaultMin?: boolean;
  onSave: StickerTypeFormDialogProps['onSave'];
  /** Dipanggil setelah simpan berhasil. */
  onClose: () => void;
  /** Proses simpan berjalan atau tidak (untuk tombol Simpan di luar form). */
  onBusyChange?: (busy: boolean) => void;
  /** Simpan harus nonaktif (nama masih kosong). */
  onBlockedChange?: (blocked: boolean) => void;
}

/**
 * Field form jenis stiker: hanya `<form id={formId}>`, tanpa tombol. Terpasang hanya saat dialog terbuka, sehingga
 * isian dan galat selalu mulai bersih.
 */
export function StickerTypeForm({
  formId,
  type,
  canSetDefaultMin = false,
  onSave,
  onClose,
  onBusyChange,
  onBlockedChange,
}: StickerTypeFormProps) {
  // Ponsel: tanpa fokus otomatis (papan ketik layar akan menutupi separuh form).
  const desktop = useIsDesktop();
  // Jenis sistem (Manual Book, Postel): nama dan aturan terkunci; hanya minimum bawaan yang boleh diubah.
  const system = type?.systemKind !== undefined && type.systemKind !== '';
  const [name, setName] = useState(type?.name ?? '');
  const [rule, setRule] = useState<StickerRule>(type?.rule ?? 'bu');
  const [nameError, setNameError] = useState<string | null>(null);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const initialDefaultMin = String(type?.defaultMinQty ?? 0);
  const [defaultMin, setDefaultMin] = useState(initialDefaultMin);
  const [defaultMinError, setDefaultMinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(
    name !== (type?.name ?? '') ||
      rule !== (type?.rule ?? 'bu') ||
      (canSetDefaultMin && defaultMin !== initialDefaultMin),
  );
  // Versi saat form dibuka: tidak ikut berubah bila daftar dimuat ulang, agar versi usang tetap terdeteksi.
  const [expectedUpdatedAt] = useState(type?.updatedAt);
  useEffect(() => {
    onBlockedChange?.(name.trim() === '');
  }, [name, onBlockedChange]);
  /** Aturan terkunci sesudah jenis dipakai stiker (server menolak perubahannya). */
  const ruleLocked = system || (type !== undefined && type.stickerCount > 0);

  async function submit() {
    if (busy) return;
    const parsed = stickerTypeFormSchema.safeParse({
      name,
      // Aturan jenis sistem (mis. `group`) di luar pilihan pengguna: tak diperiksa dan dikirim apa adanya.
      rule: system ? 'none' : rule,
      defaultMinQty: defaultMin.trim() === '' ? 0 : Number(defaultMin),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (issue?.path[0] === 'defaultMinQty') setDefaultMinError(issue.message);
      else setNameError(issue?.message ?? 'Isian tidak valid');
      return;
    }
    // Hanya dikirim bila boleh diubah dan berbeda dari nilai saat form dibuka (jenis lama) atau bukan 0 (jenis baru).
    const sendDefault =
      canSetDefaultMin && parsed.data.defaultMinQty !== (type?.defaultMinQty ?? 0)
        ? { defaultMinQty: parsed.data.defaultMinQty }
        : {};
    setBusy(true);
    onBusyChange?.(true);
    let failure: StickerTypeSaveFailure | null;
    try {
      const input: StickerTypeSaveInput = type
        ? {
            id: type.id,
            ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }),
            name: parsed.data.name,
            rule: system ? rule : parsed.data.rule,
            ...sendDefault,
          }
        : { name: parsed.data.name, rule: parsed.data.rule, ...sendDefault };
      const result = await onSave(input);
      failure = typeof result === 'string' ? { message: result } : result;
    } catch {
      // Galat tak terduga (mis. jaringan) menjadi pesan, bukan membuat tombol macet.
      failure = { message: 'Gagal menyimpan jenis stiker' };
    }
    setBusy(false);
    onBusyChange?.(false);
    setNameError(
      failure
        ? (failure.name ?? (failure.rule || failure.defaultMinQty ? null : failure.message))
        : null,
    );
    setRuleError(failure?.rule ?? null);
    setDefaultMinError(failure?.defaultMinQty ?? null);
    if (failure === null) onClose();
  }

  return (
    <form
      id={formId}
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="sticker-type-name" required>
          Nama jenis
        </Label>
        <Input
          id="sticker-type-name"
          aria-required="true"
          autoFocus={desktop && !system}
          disabled={system}
          maxLength={STICKER_LIMITS.nameMax}
          value={name}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? 'sticker-type-name-error' : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
        />
        {nameError ? (
          <p id="sticker-type-name-error" role="alert" className="text-sm text-destructive-text">
            {nameError}
          </p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        {ruleLocked ? (
          <>
            <p className="text-sm font-medium">Aturan</p>
            <p className="text-sm">{STICKER_RULE_LABEL[rule]}</p>
            <p className="text-xs text-muted-foreground">
              {system
                ? 'Aturan jenis sistem dikelola aplikasi dan tidak dapat diubah.'
                : 'Aturan tidak dapat diubah karena sudah ada stiker pada jenis ini.'}
            </p>
          </>
        ) : (
          <>
            <Select
              id="sticker-type-rule"
              label="Aturan"
              options={USER_STICKER_RULES.map((value) => ({
                value,
                label: STICKER_RULE_LABEL[value],
              }))}
              value={rule}
              error={ruleError ?? undefined}
              onValueChange={(next) => {
                setRule(next as StickerRule);
                setRuleError(null);
              }}
            />
            <p className="text-xs text-muted-foreground">{STICKER_RULE_HINT[rule]}</p>
          </>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sticker-type-default-min">Minimum stok bawaan</Label>
        <Input
          id="sticker-type-default-min"
          type="number"
          inputMode="numeric"
          min={0}
          max={STICKER_LIMITS.qtyMax}
          step={1}
          placeholder="0"
          value={defaultMin}
          disabled={!canSetDefaultMin}
          aria-invalid={defaultMinError ? true : undefined}
          onChange={(event) => {
            setDefaultMin(event.target.value);
            setDefaultMinError(null);
          }}
        />
        <p className="text-xs text-muted-foreground">
          {canSetDefaultMin
            ? 'Batas minimum awal untuk stiker baru pada jenis ini (boleh diubah per stiker); 0 = tanpa peringatan. Sama dengan pengaturan di Konfigurasi.'
            : 'Hanya pengguna dengan izin Kelola pada Stiker yang dapat mengubah minimum bawaan.'}
        </p>
        {defaultMinError ? (
          <p role="alert" className="text-sm text-destructive-text">
            {defaultMinError}
          </p>
        ) : null}
      </div>
      {/* Penerima Enter di kolom isian: tombol Simpan sebenarnya ada di footer dialog (di luar form). */}
      <button type="submit" hidden tabIndex={-1} aria-hidden />
    </form>
  );
}

export const STICKER_TYPE_FORM_ID = 'sticker-type-form';

/** Dialog tambah/ubah jenis stiker (nama dan aturan; aturan terkunci bila sudah ada stiker). */
export function StickerTypeFormDialog({
  open,
  onOpenChange,
  type,
  canSetDefaultMin,
  onSave,
}: StickerTypeFormDialogProps) {
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(true);
  return (
    <FormDialogShell
      open={open}
      onOpenChange={onOpenChange}
      formId={STICKER_TYPE_FORM_ID}
      title={type ? `Ubah jenis ${type.name}` : 'Tambah jenis stiker'}
      description="Aturan menentukan cara stiker pada jenis ini dikaitkan dengan item."
      submitting={busy}
      submitDisabled={blocked}
    >
      {open ? (
        <StickerTypeForm
          key={type?.id ?? 'new'}
          formId={STICKER_TYPE_FORM_ID}
          type={type}
          canSetDefaultMin={canSetDefaultMin}
          onSave={onSave}
          onClose={() => onOpenChange(false)}
          onBusyChange={setBusy}
          onBlockedChange={setBlocked}
        />
      ) : null}
    </FormDialogShell>
  );
}
