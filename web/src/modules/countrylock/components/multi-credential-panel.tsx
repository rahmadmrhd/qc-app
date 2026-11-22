import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hasControlChars } from '../lib/safe-text';

/** Batas sama dengan skema kontrak jembatan (`MultiCredentialSchema`). */
const USERNAME_MAX = 128;
const PASSWORD_MAX = 256;

/**
 * Antrean kredensial tambahan (L4.6): kredensial bawaan merk dicoba lebih dulu, lalu antrean ini. Hanya jumlahnya yang
 * tampil; sandi tidak pernah dirender (juga tidak oleh proses utama: snapshot hanya memuat jumlah).
 */
export function MultiCredentialPanel({
  count,
  onAdd,
}: {
  count: number;
  onAdd(cred: { username: string; password: string }): void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const valid =
    username.trim() !== '' &&
    password !== '' &&
    username.length <= USERNAME_MAX &&
    password.length <= PASSWORD_MAX &&
    !hasControlChars(username) &&
    !hasControlChars(password);

  function add() {
    if (!valid) return;
    onAdd({ username, password });
    setUsername('');
    setPassword('');
  }

  return (
    <fieldset className="space-y-2 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Kredensial tambahan</legend>
      <p className="text-xs text-muted-foreground">
        Dicoba setelah kredensial bawaan merk. Antrian kredensial: {count}. Menambah kredensial
        mencoba lagi perangkat yang menolak kredensial sebelumnya.
      </p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <Input
          aria-label="Username kredensial"
          autoComplete="off"
          placeholder="Username"
          className="w-40"
          maxLength={USERNAME_MAX}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <Input
          aria-label="Password kredensial"
          type="password"
          autoComplete="off"
          placeholder="Password"
          className="w-40"
          maxLength={PASSWORD_MAX}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button
          type="submit"
          size="icon"
          variant="outline"
          color="primary"
          aria-label="Tambah kredensial"
          disabled={!valid}
        >
          <Plus />
        </Button>
      </form>
    </fieldset>
  );
}
