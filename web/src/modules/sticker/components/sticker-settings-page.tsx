import type { SaveStickerSettingsInput, StickerSettingsDto, UserDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { STICKER_LIMITS } from '@shared/stickers';
import { useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface StickerSettingsPageProps {
  settings: StickerSettingsDto;
  /** Daftar user untuk saran penerima; `null` bila pengguna tak boleh melihat Akses (email bebas tetap dapat diisi). */
  users: readonly UserDto[] | null;
  /** Mengembalikan pesan galat (tampil di halaman) atau `null` bila berhasil. */
  onSave: (input: SaveStickerSettingsInput) => Promise<string | null>;
}

function parseQty(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return 0;
  const value = Number(text);
  return Number.isInteger(value) && value >= 0 && value <= STICKER_LIMITS.qtyMax ? value : null;
}

function userLabel(user: Pick<UserDto, 'name' | 'email'>): string {
  return `${user.name} (${user.email})`;
}

function Body({ settings, users, onSave }: StickerSettingsPageProps) {
  const [defaults, setDefaults] = useState<Record<string, string>>(() =>
    Object.fromEntries(settings.types.map((type) => [type.id, String(type.defaultMinQty)])),
  );
  const [enabled, setEnabled] = useState(settings.alert.enabled);
  const [hour, setHour] = useState(String(settings.alert.digestHour));
  const [intervalText, setIntervalText] = useState(String(settings.alert.intervalDays));
  const [recipients, setRecipients] = useState<string[]>(settings.alert.recipients);
  const [extra, setExtra] = useState('');
  const [term, setTerm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(
    enabled !== settings.alert.enabled ||
      hour !== String(settings.alert.digestHour) ||
      intervalText !== String(settings.alert.intervalDays) ||
      recipients.join('|') !== settings.alert.recipients.join('|') ||
      extra.trim() !== '' ||
      settings.types.some((type) => defaults[type.id] !== String(type.defaultMinQty)),
  );

  const userByEmail = new Map((users ?? []).map((user) => [user.email.toLowerCase(), user]));
  const chosen = new Set(recipients);
  const termKey = normalizeKey(term);
  const options: LinkOption[] = (users ?? [])
    .filter((user) => user.status === 'active' && !chosen.has(user.email.toLowerCase()))
    .filter(
      (user) => termKey === '' || normalizeKey(`${user.name} ${user.email}`).includes(termKey),
    )
    .slice(0, 50)
    .map((user) => ({ id: user.email.toLowerCase(), label: userLabel(user) }));

  function fail(key: string, message: string | undefined) {
    setErrors((current) => {
      const next = { ...current };
      if (message === undefined) delete next[key];
      else next[key] = message;
      return next;
    });
  }

  function addRecipients(ids: string[]) {
    if (ids.length > STICKER_LIMITS.alertRecipientsMax) {
      fail('recipients', `Maksimal ${STICKER_LIMITS.alertRecipientsMax} penerima`);
      return;
    }
    setRecipients(ids);
    fail('recipients', undefined);
  }

  function addExtra() {
    const email = extra.trim().toLowerCase();
    if (email === '') return;
    if (!EMAIL_PATTERN.test(email)) {
      fail('recipients', 'Format email tidak valid');
      return;
    }
    if (chosen.has(email)) {
      fail('recipients', 'Email sudah ada dalam daftar');
      return;
    }
    if (recipients.length >= STICKER_LIMITS.alertRecipientsMax) {
      fail('recipients', `Maksimal ${STICKER_LIMITS.alertRecipientsMax} penerima`);
      return;
    }
    setRecipients([...recipients, email]);
    setExtra('');
    fail('recipients', undefined);
  }

  async function submit() {
    if (busy) return;
    const next: Record<string, string> = {};
    const digestHour = Number(hour);
    if (hour.trim() === '' || !Number.isInteger(digestHour) || digestHour < 0 || digestHour > 23) {
      next.digestHour = 'Jam harus bilangan bulat 0 sampai 23';
    }
    const intervalDays = Number(intervalText);
    if (
      intervalText.trim() === '' ||
      !Number.isInteger(intervalDays) ||
      intervalDays < 1 ||
      intervalDays > STICKER_LIMITS.alertIntervalDaysMax
    ) {
      next.intervalDays = `Selang harus bilangan bulat 1 sampai ${STICKER_LIMITS.alertIntervalDaysMax} hari`;
    }
    const changed: SaveStickerSettingsInput['defaults'] = [];
    for (const type of settings.types) {
      const qty = parseQty(defaults[type.id] ?? '');
      if (qty === null) {
        next[`default-${type.id}`] =
          `Minimum bawaan ${type.name}: bilangan bulat 0 sampai ${STICKER_LIMITS.qtyMax}`;
      } else if (qty !== type.defaultMinQty) {
        changed.push({ typeId: type.id, defaultMinQty: qty });
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    setServerError(null);
    let message: string | null;
    try {
      message = await onSave({
        expectedUpdatedAt: settings.updatedAt,
        alert: { enabled, recipients, digestHour, intervalDays },
        defaults: changed,
      });
    } catch {
      message = 'Gagal menyimpan konfigurasi stiker';
    }
    setBusy(false);
    setServerError(message);
  }

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="text-base font-semibold">Minimum stok bawaan per jenis</h2>
        <p className="text-sm text-muted-foreground">
          Dipakai sebagai batas minimum stiker baru pada jenis itu (0 = tanpa peringatan). Stiker
          yang sudah ada tidak berubah. Untuk jenis Manual Book, stiker versi pertama memakai nilai
          ini.
        </p>
        <ul className="divide-y rounded-md border">
          {settings.types.map((type) => (
            <li key={type.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="flex items-center gap-2">
                <Label htmlFor={`default-${type.id}`} className="font-medium">
                  {`Minimum bawaan ${type.name}`}
                </Label>
                {type.systemKind !== '' ? <Badge variant="outline">Sistem</Badge> : null}
              </div>
              <div className="space-y-1">
                <Input
                  id={`default-${type.id}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={STICKER_LIMITS.qtyMax}
                  step={1}
                  className="w-32"
                  value={defaults[type.id] ?? ''}
                  aria-invalid={errors[`default-${type.id}`] ? true : undefined}
                  onChange={(event) => {
                    setDefaults((current) => ({ ...current, [type.id]: event.target.value }));
                    fail(`default-${type.id}`, undefined);
                  }}
                />
                {errors[`default-${type.id}`] ? (
                  <p role="alert" className="text-sm text-destructive-text">
                    {errors[`default-${type.id}`]}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="text-base font-semibold">Ringkasan harian stok menipis dan habis</h2>
        <p className="text-sm text-muted-foreground">
          Bagian "Habis": stiker aktif yang total stok semua lokasinya 0 atau kurang, apa pun
          minimumnya. Bagian "Menipis": stiker aktif dengan minimum lebih dari 0 yang stoknya di
          bawah atau sama dengan minimum tetapi belum habis (minimum 0 tidak pernah menipis). Stiker
          nonaktif dan stiker usang (deprecated) tidak dihitung.
        </p>
        {settings.smtpConfigured ? null : (
          <p
            role="status"
            className="rounded-md border border-warning-text/35 bg-warning-text/10 p-3 text-sm"
          >
            SMTP belum dikonfigurasi di server: ringkasan tidak akan terkirim sampai SMTP diatur
            (lihat dokumen penyebaran).
          </p>
        )}
        <div className="flex items-center gap-2">
          <Checkbox
            id="sticker-alert-enabled"
            checked={enabled}
            onCheckedChange={(next) => setEnabled(next === true)}
          />
          <Label htmlFor="sticker-alert-enabled" className="font-normal">
            Kirim ringkasan harian stok menipis dan habis
          </Label>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sticker-alert-hour" required>
            Jam kirim (WIB)
          </Label>
          <Input
            id="sticker-alert-hour"
            aria-required="true"
            type="number"
            inputMode="numeric"
            min={0}
            max={23}
            step={1}
            className="w-24"
            value={hour}
            aria-invalid={errors.digestHour ? true : undefined}
            onChange={(event) => {
              setHour(event.target.value);
              fail('digestHour', undefined);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Ringkasan dikirim paling awal pada jam ini, hanya bila ada stok yang menipis atau habis.
          </p>
          {errors.digestHour ? (
            <p role="alert" className="text-sm text-destructive-text">
              {errors.digestHour}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sticker-alert-interval" required>
            Kirim setiap (hari)
          </Label>
          <Input
            id="sticker-alert-interval"
            aria-required="true"
            type="number"
            inputMode="numeric"
            min={1}
            max={STICKER_LIMITS.alertIntervalDaysMax}
            step={1}
            className="w-24"
            value={intervalText}
            aria-invalid={errors.intervalDays ? true : undefined}
            onChange={(event) => {
              setIntervalText(event.target.value);
              fail('intervalDays', undefined);
            }}
          />
          <p className="text-xs text-muted-foreground">
            1 = tiap hari selama masih ada stok menipis atau habis; 7 = paling banyak sekali
            seminggu.
          </p>
          {errors.intervalDays ? (
            <p role="alert" className="text-sm text-destructive-text">
              {errors.intervalDays}
            </p>
          ) : null}
        </div>
        <fieldset aria-label="Penerima ringkasan" className="m-0 min-w-0 space-y-2 border-0 p-0">
          <LinkMultiField
            id="sticker-alert-recipients"
            label="Penerima"
            placeholder={users === null ? 'Tambahkan email di bawah' : 'Pilih user'}
            value={recipients}
            labelOf={(id) => {
              const user = userByEmail.get(id);
              return user ? userLabel(user) : id;
            }}
            options={options}
            onSearchChange={setTerm}
            searchDebounceMs={0}
            onChange={addRecipients}
          />
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="sticker-alert-extra">Email lain</Label>
              <Input
                id="sticker-alert-extra"
                type="email"
                className="w-72"
                value={extra}
                onChange={(event) => setExtra(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addExtra();
                  }
                }}
              />
            </div>
            <Button type="button" variant="outline" onClick={addExtra}>
              Tambah email
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Maksimal {STICKER_LIMITS.alertRecipientsMax} penerima; alamat di luar daftar user boleh
            ditambahkan.
          </p>
          {errors.recipients ? (
            <p role="alert" className="text-sm text-destructive-text">
              {errors.recipients}
            </p>
          ) : null}
        </fieldset>
      </section>

      {serverError ? (
        <p role="alert" className="text-sm text-destructive-text">
          {serverError}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? 'Menyimpan…' : 'Simpan'}
      </Button>
    </form>
  );
}

/** Konfigurasi Stiker: minimum bawaan per jenis dan email ringkasan harian stok menipis (`sticker: manage`). */
export function StickerSettingsPage(props: StickerSettingsPageProps) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Konfigurasi Stiker</h1>
      {/* `key` = versi tersimpan: setelah simpan (atau muat ulang) isian mulai dari data server terbaru. */}
      <Body key={props.settings.updatedAt} {...props} />
    </div>
  );
}
