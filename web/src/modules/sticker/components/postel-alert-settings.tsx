import type { PostelSettingsDto, SavePostelSettingsInput, UserDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { POSTEL_LIMITS } from '@shared/postel';
import { useState } from 'react';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { Select } from '@/components/select';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const THRESHOLD_MAX = POSTEL_LIMITS.thresholdDaysMax;

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, '0')}:00 WIB`,
}));

export interface PostelAlertSettingsProps {
  settings: PostelSettingsDto;
  /** Daftar user untuk saran penerima; `null` bila pengguna tak boleh melihat Akses (email bebas tetap dapat diisi). */
  users: readonly UserDto[] | null;
  /** Mengembalikan pesan galat (tampil di bagian ini) atau `null` bila berhasil. */
  onSave: (input: SavePostelSettingsInput) => Promise<string | null>;
}

function userLabel(user: Pick<UserDto, 'name' | 'email'>): string {
  return `${user.name} (${user.email})`;
}

/** Bilangan bulat dalam rentang dari teks input; `null` bila kosong/tak sah. */
function parseInteger(raw: string, min: number, max: number): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function Body({ settings, users, onSave }: PostelAlertSettingsProps) {
  const { alert } = settings;
  const [enabled, setEnabled] = useState(alert.enabled);
  const [hour, setHour] = useState(String(alert.sendHour));
  const [thresholds, setThresholds] = useState<string[]>(alert.thresholds.map(String));
  const [repeat, setRepeat] = useState(String(alert.repeatEveryDays));
  const [recipients, setRecipients] = useState<string[]>(alert.recipients);
  const [extra, setExtra] = useState('');
  const [term, setTerm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    if (ids.length > POSTEL_LIMITS.recipientsMax) {
      fail('recipients', `Maksimal ${POSTEL_LIMITS.recipientsMax} penerima`);
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
    if (recipients.length >= POSTEL_LIMITS.recipientsMax) {
      fail('recipients', `Maksimal ${POSTEL_LIMITS.recipientsMax} penerima`);
      return;
    }
    setRecipients([...recipients, email]);
    setExtra('');
    fail('recipients', undefined);
  }

  async function submit() {
    if (busy) return;
    const next: Record<string, string> = {};
    const parsed: number[] = [];
    if (thresholds.length === 0) next.thresholds = 'Isi minimal satu pengingat';
    thresholds.forEach((raw, index) => {
      const value = parseInteger(raw, 1, THRESHOLD_MAX);
      if (value === null)
        next[`threshold-${index}`] =
          `Pengingat ${index + 1}: bilangan bulat 1 sampai ${THRESHOLD_MAX}`;
      else parsed.push(value);
    });
    if (new Set(parsed).size !== parsed.length) next.thresholds = 'Pengingat tidak boleh kembar';
    const repeatEveryDays = parseInteger(repeat, 0, POSTEL_LIMITS.repeatDaysMax);
    if (repeatEveryDays === null)
      next.repeat = `Ulangi setiap: bilangan bulat 0 sampai ${POSTEL_LIMITS.repeatDaysMax}`;
    setErrors(next);
    if (Object.keys(next).length > 0 || repeatEveryDays === null) return;
    setBusy(true);
    setServerError(null);
    let message: string | null;
    try {
      message = await onSave({
        expectedUpdatedAt: settings.updatedAt,
        alert: {
          enabled,
          recipients,
          sendHour: Number(hour),
          thresholds: [...parsed].sort((a, b) => b - a),
          repeatEveryDays,
        },
      });
    } catch {
      message = 'Gagal menyimpan pengaturan peringatan Postel';
    }
    setBusy(false);
    setServerError(message);
  }

  return (
    <form
      noValidate
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 className="text-base font-semibold">Peringatan masa berlaku Postel</h2>
      <p className="text-sm text-muted-foreground">
        Email ringkasan harian berisi nomor Postel Aktif yang mendekati atau melewati tanggal habis
        (hanya nama Postel, tanpa nama atau jumlah item). Penerimanya terpisah dari penerima
        ringkasan stok menipis.
      </p>
      {settings.smtpConfigured ? null : (
        <p
          role="status"
          className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
        >
          SMTP belum dikonfigurasi di server: peringatan tidak akan terkirim sampai SMTP diatur
          (lihat dokumen penyebaran).
        </p>
      )}
      <div className="flex items-center gap-2">
        <Checkbox
          id="postel-alert-enabled"
          checked={enabled}
          onCheckedChange={(value) => setEnabled(value === true)}
        />
        <Label htmlFor="postel-alert-enabled" className="font-normal">
          Kirim email peringatan masa berlaku Postel
        </Label>
      </div>
      <Select
        id="postel-alert-hour"
        label="Jam kirim (WIB)"
        className="w-48"
        options={HOUR_OPTIONS}
        value={hour}
        onValueChange={setHour}
      />
      <fieldset
        aria-label="Pengingat hari sebelum habis"
        className="m-0 min-w-0 space-y-2 border-0 p-0"
      >
        <p className="text-sm font-medium">Pengingat (hari sebelum habis)</p>
        <p className="text-xs text-muted-foreground">
          1 sampai {POSTEL_LIMITS.thresholdsMax} nilai, tiap nilai 1 sampai {THRESHOLD_MAX} hari dan
          tidak kembar. Nilai terkecil juga menjadi ambang pengingat ulang.
        </p>
        {thresholds.map((value, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: baris isian tanpa id stabil
            key={index}
            className="space-y-1"
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={THRESHOLD_MAX}
                step={1}
                className="w-28"
                aria-label={`Pengingat ${index + 1} (hari sebelum habis)`}
                aria-invalid={errors[`threshold-${index}`] ? true : undefined}
                value={value}
                onChange={(event) => {
                  setThresholds((current) =>
                    current.map((entry, i) => (i === index ? event.target.value : entry)),
                  );
                  fail(`threshold-${index}`, undefined);
                  fail('thresholds', undefined);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Hapus pengingat ${index + 1}`}
                onClick={() => {
                  setThresholds((current) => current.filter((_, i) => i !== index));
                  setErrors((current) => {
                    const rest = { ...current };
                    for (const key of Object.keys(rest))
                      if (key.startsWith('threshold')) delete rest[key];
                    return rest;
                  });
                }}
              >
                Hapus
              </Button>
            </div>
            {errors[`threshold-${index}`] ? (
              <p role="alert" className="text-sm text-destructive">
                {errors[`threshold-${index}`]}
              </p>
            ) : null}
          </div>
        ))}
        {errors.thresholds ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.thresholds}
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={thresholds.length >= POSTEL_LIMITS.thresholdsMax}
          onClick={() => setThresholds((current) => [...current, ''])}
        >
          Tambah pengingat
        </Button>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="postel-alert-repeat">Ulangi setiap (hari)</Label>
        <Input
          id="postel-alert-repeat"
          type="number"
          inputMode="numeric"
          min={0}
          max={POSTEL_LIMITS.repeatDaysMax}
          step={1}
          className="w-28"
          value={repeat}
          aria-invalid={errors.repeat ? true : undefined}
          onChange={(event) => {
            setRepeat(event.target.value);
            fail('repeat', undefined);
          }}
        />
        <p className="text-xs text-muted-foreground">
          Pengingat ulang sejak ambang terkecil tercapai sampai tanggalnya diperpanjang; 0 = tanpa
          pengulangan.
        </p>
        {errors.repeat ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.repeat}
          </p>
        ) : null}
      </div>
      <fieldset
        aria-label="Penerima peringatan Postel"
        className="m-0 min-w-0 space-y-2 border-0 p-0"
      >
        <LinkMultiField
          id="postel-alert-recipients"
          label="Penerima peringatan Postel"
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
            <Label htmlFor="postel-alert-extra">Email lain</Label>
            <Input
              id="postel-alert-extra"
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
          Maksimal {POSTEL_LIMITS.recipientsMax} penerima; alamat di luar daftar user boleh
          ditambahkan.
        </p>
        {errors.recipients ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.recipients}
          </p>
        ) : null}
      </fieldset>
      {serverError ? (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? 'Menyimpan…' : 'Simpan peringatan Postel'}
      </Button>
    </form>
  );
}

/**
 * Peringatan masa berlaku Postel pada halaman Konfigurasi Stiker (`sticker: manage`): saklar, jam kirim, pengingat
 * hari-sebelum-habis, pengulangan, dan penerima. Disimpan sendiri (versi CAS terpisah dari pengaturan stok).
 */
export function PostelAlertSettings(props: PostelAlertSettingsProps) {
  // `key` = versi tersimpan: setelah simpan (atau muat ulang) isian mulai dari data server terbaru.
  return <Body key={props.settings.updatedAt} {...props} />;
}
