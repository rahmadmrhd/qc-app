import type { ClFirmwareDto } from '@shared/contract';
import { FIRMWARE_CODE_MAX } from '@shared/countrylock-bundle';
import { hasControlChars } from '@shared/text';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { LinkField } from '@/components/link-field';
import { Select } from '@/components/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api/describe-error';
import { BRAND_OPTIONS } from '../lib/labels';
import { filesQueryOptions, useSaveFirmware } from '../queries';
import { BinaryUploadDialog } from './binary-upload';
import { ScriptRefs } from './script-refs';

const FORM_ID = 'cl-firmware-form';
const LABEL_MAX = 120;

export interface FirmwareFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Firmware yang diubah; `null` = firmware baru. */
  firmware: ClFirmwareDto | null;
  /** Urutan bawaan firmware baru (di bawah yang sudah ada). */
  nextSort: number;
}

/**
 * Form firmware (dialog): merk, kode, label, skrip (berkas role `script` di draf, dipilih lewat `LinkField`), paralel,
 * urutan. Merk dan kode terkunci selama masih dipakai Item (server menolak mengubahnya = CONFLICT). Mengubah firmware
 * mengirim `id` + `expectedUpdatedAt` agar suntingan yang basi ditolak server.
 */
export function FirmwareFormDialog({
  open,
  onOpenChange,
  firmware,
  nextSort,
}: FirmwareFormDialogProps) {
  const save = useSaveFirmware();
  const files = useQuery({ ...filesQueryOptions(), enabled: open });
  const [brand, setBrand] = useState<'mikrotik' | 'ubiquiti'>('mikrotik');
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [scriptPath, setScriptPath] = useState<string | null>(null);
  const [parallel, setParallel] = useState(false);
  const [sort, setSort] = useState('10');
  const [error, setError] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBrand(firmware?.brand ?? 'mikrotik');
    setCode(firmware?.code ?? '');
    setLabel(firmware?.label ?? '');
    setScriptPath(firmware?.scriptPath ?? null);
    setParallel(firmware?.parallel ?? false);
    setSort(String(firmware?.sort ?? nextSort));
    setError(null);
    setUploadName(null);
  }, [open, firmware, nextSort]);

  const scriptOptions = useMemo(
    () =>
      (files.data ?? [])
        .filter((file) => !file.removed && file.role === 'script')
        .map((file) => ({ id: file.path, label: file.path }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [files.data],
  );

  const identityLocked = firmware !== null && firmware.inUseCount > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedCode = code.trim();
    const trimmedLabel = label.trim();
    const sortNumber = Number(sort);
    // Aturan yang sama dengan server: 1 sampai FIRMWARE_CODE_MAX karakter, spasi boleh, tanpa karakter kontrol.
    if (
      trimmedCode === '' ||
      trimmedCode.length > FIRMWARE_CODE_MAX ||
      hasControlChars(trimmedCode)
    ) {
      setError(`Kode wajib diisi, maksimal ${FIRMWARE_CODE_MAX} karakter, tanpa karakter kontrol`);
      return;
    }
    if (trimmedLabel === '' || hasControlChars(trimmedLabel)) {
      setError('Label wajib diisi dan tanpa karakter kontrol');
      return;
    }
    if (!Number.isInteger(sortNumber) || sortNumber < 0) {
      setError('Urutan harus bilangan bulat tidak negatif');
      return;
    }
    setError(null);
    save.mutate(
      {
        ...(firmware ? { id: firmware.id, expectedUpdatedAt: firmware.updatedAt } : {}),
        brand,
        code: trimmedCode,
        label: trimmedLabel,
        scriptPath,
        parallel,
        sort: sortNumber,
      },
      {
        onSuccess: () => {
          toast.success(firmware ? 'Firmware diperbarui' : 'Firmware ditambahkan');
          onOpenChange(false);
        },
        onError: (failure) => setError(describeError(failure)),
      },
    );
  };

  return (
    <>
      <FormDialogShell
        open={open}
        onOpenChange={onOpenChange}
        formId={FORM_ID}
        title={firmware ? `Ubah firmware ${firmware.code}` : 'Tambah firmware'}
        description="Firmware yang terdaftar muncul sebagai pilihan di form Item; perubahan masuk draf dan baru dipakai desktop setelah bundel diterbitkan."
        submitting={save.isPending}
        submitLabel="Simpan"
      >
        <form id={FORM_ID} onSubmit={submit} className="space-y-4">
          <Select
            id="cl-fw-brand"
            label="Merk"
            required
            disabled={identityLocked}
            options={BRAND_OPTIONS}
            value={brand}
            onValueChange={(value) => setBrand(value as 'mikrotik' | 'ubiquiti')}
          />
          <div className="space-y-1.5">
            <Label htmlFor="cl-fw-code" required>
              Kode
            </Label>
            <Input
              id="cl-fw-code"
              value={code}
              required
              aria-required="true"
              disabled={identityLocked}
              maxLength={FIRMWARE_CODE_MAX}
              onChange={(event) => setCode(event.target.value)}
            />
            {identityLocked ? (
              <p className="text-xs text-muted-foreground">
                Merk dan kode terkunci selama masih dipakai {firmware?.inUseCount} item.
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-fw-label" required>
              Label
            </Label>
            <Input
              id="cl-fw-label"
              value={label}
              required
              aria-required="true"
              maxLength={LABEL_MAX}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <LinkField
            id="cl-fw-script"
            label="Skrip"
            options={scriptOptions}
            value={scriptPath}
            onChange={setScriptPath}
            localFilter
            loading={files.isPending}
            placeholder="Pilih berkas skrip (boleh dikosongkan)"
          />
          <ScriptRefs scriptPath={scriptPath} canUpload onUpload={setUploadName} />
          <div className="flex items-center gap-2">
            <Checkbox
              id="cl-fw-parallel"
              checked={parallel}
              onCheckedChange={(checked) => setParallel(checked === true)}
            />
            <Label htmlFor="cl-fw-parallel">Jalankan paralel</Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-fw-sort">Urutan</Label>
            <Input
              id="cl-fw-sort"
              type="number"
              inputMode="numeric"
              min={0}
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            />
          </div>
          {error === null ? null : (
            <Alert color="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </form>
      </FormDialogShell>
      {/* Di luar <form>: dialog bersarang tidak boleh meneruskan submit ke form firmware. */}
      <BinaryUploadDialog
        open={uploadName !== null}
        onOpenChange={(next) => {
          if (!next) setUploadName(null);
        }}
        {...(uploadName === null ? {} : { fixedPath: uploadName })}
        title="Unggah berkas router"
        onUploaded={() => setUploadName(null)}
      />
    </>
  );
}
