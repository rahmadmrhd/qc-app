import { useState } from 'react';
import {
  FormDialog,
  FormDialogContent,
  FormDialogDescription,
  FormDialogFooter,
  FormDialogHeader,
  FormDialogTitle,
} from '@/components/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { hasControlChars } from '../lib/safe-text';
import type { CredentialPrompt } from '../use-country-lock';

/** Batas sama dengan skema kontrak jembatan (`DeviceRequestSchema`). */
const USERNAME_MAX = 128;
const PASSWORD_MAX = 256;

interface CredentialDialogProps {
  prompt: CredentialPrompt | null;
  onSubmit: (username: string, password: string) => void;
  onCancel: () => void;
}

/** Terpasang hanya saat dialog terbuka, sehingga isian selalu mulai dari kredensial bawaan merk. */
function CredentialForm({
  prompt,
  onSubmit,
  onCancel,
}: {
  prompt: CredentialPrompt;
  onSubmit: CredentialDialogProps['onSubmit'];
  onCancel: () => void;
}) {
  const [username, setUsername] = useState(prompt.username);
  const [password, setPassword] = useState(prompt.password);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (username.trim() === '') return setError('Username wajib diisi');
    if (username.length > USERNAME_MAX || password.length > PASSWORD_MAX) {
      return setError('Username atau password terlalu panjang');
    }
    if (hasControlChars(username) || hasControlChars(password)) {
      return setError('Karakter kontrol tidak diperbolehkan');
    }
    onSubmit(username, password);
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="country-lock-username">Username</Label>
        <Input
          id="country-lock-username"
          autoComplete="off"
          maxLength={USERNAME_MAX}
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
            setError(null);
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="country-lock-password">Password</Label>
        <Input
          id="country-lock-password"
          type="text"
          autoComplete="off"
          maxLength={PASSWORD_MAX}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setError(null);
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <FormDialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit">Gunakan</Button>
      </FormDialogFooter>
    </form>
  );
}

/**
 * Meminta kredensial perangkat ketika yang dicoba ditolak ("Permission denied"). Isian awal =
 * kredensial bawaan merk dari `config.QC`. Password SENGAJA tampil apa adanya (keputusan pemilik 2026-11-18): ini
 * kredensial bawaan pabrik perangkat baru yang akan di-inject, bukan rahasia pengguna, dan operator perlu melihatnya
 * untuk memastikan isiannya benar. Tetap tidak pernah dicatat ke log atau pesan galat.
 */
export function CredentialDialog({ prompt, onSubmit, onCancel }: CredentialDialogProps) {
  return (
    <FormDialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <FormDialogContent>
        <FormDialogHeader>
          <FormDialogTitle>Kredensial perangkat</FormDialogTitle>
          <FormDialogDescription>
            {prompt?.reason || 'Masukkan username dan password perangkat.'}
          </FormDialogDescription>
        </FormDialogHeader>
        {prompt ? <CredentialForm prompt={prompt} onSubmit={onSubmit} onCancel={onCancel} /> : null}
      </FormDialogContent>
    </FormDialog>
  );
}
