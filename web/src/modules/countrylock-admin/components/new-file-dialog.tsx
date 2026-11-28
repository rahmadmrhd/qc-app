import type { ClFileDetailDto } from '@shared/contract';
import { type ClFileRole, SETTINGS_PATH, validateClPath } from '@shared/countrylock-bundle';
import { type FormEvent, useEffect, useState } from 'react';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { Select } from '@/components/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api/describe-error';
import { ROLE_LABELS } from '../lib/labels';
import { useSaveFile } from '../queries';

const FORM_ID = 'cl-new-file-form';
const ROLE_OPTIONS: { value: ClFileRole; label: string }[] = [
  { value: 'script', label: ROLE_LABELS.script },
  { value: 'router', label: `${ROLE_LABELS.router} (teks)` },
];

export interface NewFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Berkas teks kosong sudah dibuat (revisi 1); pemanggil membukanya di editor. */
  onCreated: (file: ClFileDetailDto) => void;
}

/** Dialog berkas teks baru: nama jalur dan peran (Skrip atau berkas router teks); isinya disunting sesudahnya. */
export function NewFileDialog({ open, onOpenChange, onCreated }: NewFileDialogProps) {
  const save = useSaveFile();
  const [path, setPath] = useState('');
  const [role, setRole] = useState<ClFileRole>('script');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPath('');
      setRole('script');
      setError(null);
    }
  }, [open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const target = path.trim();
    const problem =
      validateClPath(target) ??
      (target.toLowerCase() === SETTINGS_PATH
        ? 'settings.json diatur lewat halaman Pengaturan Router'
        : null);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setError(null);
    save.mutate(
      { path: target, role, text: '', message: 'Berkas dibuat' },
      {
        onSuccess: (file) => {
          onCreated(file);
          onOpenChange(false);
        },
        onError: (failure) => setError(describeError(failure)),
      },
    );
  };

  return (
    <FormDialogShell
      open={open}
      onOpenChange={onOpenChange}
      formId={FORM_ID}
      title="Berkas teks baru"
      description="Nama berkas tidak membedakan huruf besar/kecil dan tidak boleh memuat .. atau garis miring terbalik."
      submitting={save.isPending}
      submitLabel="Buat"
    >
      <form id={FORM_ID} onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cl-new-path" required>
            Nama berkas
          </Label>
          <Input
            id="cl-new-path"
            value={path}
            required
            aria-required="true"
            placeholder="mis. MIKROTIK/mikrotik-ac.txt"
            onChange={(event) => setPath(event.target.value)}
          />
        </div>
        <Select
          id="cl-new-role"
          label="Peran"
          required
          options={ROLE_OPTIONS}
          value={role}
          onValueChange={(value) => setRole(value as ClFileRole)}
        />
        {error === null ? null : (
          <Alert color="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </form>
    </FormDialogShell>
  );
}
