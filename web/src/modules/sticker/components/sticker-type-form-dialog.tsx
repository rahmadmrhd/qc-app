import type { StickerTypeDto } from '@shared/contract';
import { STICKER_LIMITS, type StickerRule, USER_STICKER_RULES } from '@shared/stickers';
import { useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import {
  FormDialog,
  FormDialogContent,
  FormDialogDescription,
  FormDialogFooter,
  FormDialogHeader,
  FormDialogTitle,
} from '@/components/form-dialog';
import { Select } from '@/components/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
}

/** Galat simpan: pesan umum dan, bila server menyebut field, pesan khusus field itu. */
export interface StickerTypeSaveFailure {
  message: string;
  name?: string;
  rule?: string;
}

export type StickerTypeSaveResult = string | StickerTypeSaveFailure | null;

/** Mengubah galat API menjadi hasil simpan dialog (dipakai pemanggil yang memanggil API jenis stiker). */
export function stickerTypeSaveFailure(error: unknown): StickerTypeSaveFailure {
  if (isStaleSaveError(error)) return { message: STALE_SAVE_MESSAGE };
  const fields = pickFieldErrors(error, ['name', 'rule'] as const);
  return { message: describeError(error), ...fields };
}

export interface StickerTypeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Jenis yang diubah; kosong = jenis baru. */
  type?: Pick<StickerTypeDto, 'id' | 'name' | 'rule' | 'stickerCount' | 'updatedAt'>;
  /** `null` = berhasil (dialog menutup sendiri); string/objek = galat yang tampil di dialog. */
  onSave: (input: StickerTypeSaveInput) => Promise<StickerTypeSaveResult>;
}

interface StickerTypeFormBodyProps {
  type?: StickerTypeFormDialogProps['type'];
  onSave: StickerTypeFormDialogProps['onSave'];
  onClose: () => void;
}

/** Terpasang hanya saat dialog terbuka, sehingga isian dan galat selalu mulai bersih. */
function StickerTypeFormBody({ type, onSave, onClose }: StickerTypeFormBodyProps) {
  const [name, setName] = useState(type?.name ?? '');
  const [rule, setRule] = useState<StickerRule>(type?.rule ?? 'bu');
  const [nameError, setNameError] = useState<string | null>(null);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(name !== (type?.name ?? '') || rule !== (type?.rule ?? 'bu'));
  // Versi saat form dibuka: tidak ikut berubah bila daftar dimuat ulang, agar versi usang tetap terdeteksi.
  const [expectedUpdatedAt] = useState(type?.updatedAt);
  /** Aturan terkunci sesudah jenis dipakai stiker (server menolak perubahannya). */
  const ruleLocked = type !== undefined && type.stickerCount > 0;

  async function submit() {
    if (busy) return;
    const parsed = stickerTypeFormSchema.safeParse({ name, rule });
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? 'Isian tidak valid');
      return;
    }
    setBusy(true);
    let failure: StickerTypeSaveFailure | null;
    try {
      const input: StickerTypeSaveInput = type
        ? {
            id: type.id,
            ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }),
            name: parsed.data.name,
            rule: parsed.data.rule,
          }
        : { name: parsed.data.name, rule: parsed.data.rule };
      const result = await onSave(input);
      failure = typeof result === 'string' ? { message: result } : result;
    } catch {
      // Galat tak terduga (mis. jaringan) menjadi pesan, bukan membuat tombol macet.
      failure = { message: 'Gagal menyimpan jenis stiker' };
    }
    setBusy(false);
    setNameError(failure ? (failure.name ?? (failure.rule ? null : failure.message)) : null);
    setRuleError(failure?.rule ?? null);
    if (failure === null) onClose();
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="sticker-type-name">Nama jenis</Label>
        <Input
          id="sticker-type-name"
          autoFocus
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
          <p id="sticker-type-name-error" role="alert" className="text-sm text-destructive">
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
              Aturan tidak dapat diubah karena sudah ada stiker pada jenis ini.
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
      <FormDialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" disabled={busy || name.trim() === ''}>
          {busy ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </FormDialogFooter>
    </form>
  );
}

/** Dialog tambah/ubah jenis stiker (nama dan aturan; aturan terkunci bila sudah ada stiker). */
export function StickerTypeFormDialog({
  open,
  onOpenChange,
  type,
  onSave,
}: StickerTypeFormDialogProps) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent>
        <FormDialogHeader>
          <FormDialogTitle>
            {type ? `Ubah jenis ${type.name}` : 'Tambah jenis stiker'}
          </FormDialogTitle>
          <FormDialogDescription>
            Aturan menentukan cara stiker pada jenis ini dikaitkan dengan item.
          </FormDialogDescription>
        </FormDialogHeader>
        {open ? (
          <StickerTypeFormBody
            key={type?.id ?? 'new'}
            type={type}
            onSave={onSave}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </FormDialogContent>
    </FormDialog>
  );
}
