import type {
  PostelSettingsDto,
  SavePostelSettingsInput,
  SaveStickerSettingsInput,
  StickerSettingsDto,
  UserDto,
} from '@shared/contract';
import { mailListsOf, sameMailLists } from '@shared/mail-lists';
import { STICKER_LIMITS } from '@shared/stickers';
import { useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { MailListsFields, type RecipientSuggestion } from '@/components/mail-lists-field';
import { FormPage } from '@/components/page/form-page';
import { FormTabs } from '@/components/page/form-tabs';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PostelAlertSettings } from './postel-alert-settings';

/** Id `<form>` pengaturan stok (tab "Minimum stok" dan "Ringkasan stok" disimpan bersama). */
export const STICKER_SETTINGS_FORM_ID = 'sticker-settings';
/** Id `<form>` peringatan Postel (disimpan sendiri, versi CAS terpisah). */
export const POSTEL_ALERT_FORM_ID = 'postel-alert-settings';

export const SETTINGS_TABS = ['minimum', 'ringkasan', 'postel'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

function parseQty(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return 0;
  const value = Number(text);
  return Number.isInteger(value) && value >= 0 && value <= STICKER_LIMITS.qtyMax ? value : null;
}

function initialDefaults(settings: StickerSettingsDto): Record<string, string> {
  return Object.fromEntries(settings.types.map((type) => [type.id, String(type.defaultMinQty)]));
}

/**
 * Keadaan form pengaturan stok. Dipegang di atas `FormTabs` (satu `<form>` tak dapat membungkus sebagian tab), jadi
 * isian tetap hidup saat berpindah tab. Setelah simpan (versi `updatedAt` berubah) isian mulai lagi dari data server.
 */
function useStickerSettingsForm({
  settings,
  users,
  onSave,
  onInvalid,
}: {
  settings: StickerSettingsDto;
  users: readonly UserDto[] | null;
  onSave: (input: SaveStickerSettingsInput) => Promise<string | null>;
  /** Validasi gagal: tab pertama yang memuat galat (dibuka oleh halaman). */
  onInvalid: (tab: SettingsTab) => void;
}) {
  const [version, setVersion] = useState(settings.updatedAt);
  const [defaults, setDefaults] = useState(() => initialDefaults(settings));
  const [enabled, setEnabled] = useState(settings.alert.enabled);
  const [hour, setHour] = useState(String(settings.alert.digestHour));
  const [intervalText, setIntervalText] = useState(String(settings.alert.intervalDays));
  const [lists, setLists] = useState(() => mailListsOf(settings.alert));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (version !== settings.updatedAt) {
    // Versi tersimpan berubah (simpan berhasil atau dimuat ulang): isian dari data server terbaru.
    setVersion(settings.updatedAt);
    setDefaults(initialDefaults(settings));
    setEnabled(settings.alert.enabled);
    setHour(String(settings.alert.digestHour));
    setIntervalText(String(settings.alert.intervalDays));
    setLists(mailListsOf(settings.alert));
    setErrors({});
    setServerError(null);
  }

  useUnsavedChanges(
    enabled !== settings.alert.enabled ||
      hour !== String(settings.alert.digestHour) ||
      intervalText !== String(settings.alert.intervalDays) ||
      !sameMailLists(lists, mailListsOf(settings.alert)) ||
      settings.types.some((type) => defaults[type.id] !== String(type.defaultMinQty)),
  );

  const suggestions: RecipientSuggestion[] = (users ?? []).map((user) => ({
    name: user.name,
    email: user.email,
    active: user.status === 'active',
  }));

  function fail(key: string, message: string | undefined) {
    setErrors((current) => {
      const next = { ...current };
      if (message === undefined) delete next[key];
      else next[key] = message;
      return next;
    });
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
    const keys = Object.keys(next);
    if (keys.length > 0) {
      onInvalid(keys.some((key) => key.startsWith('default-')) ? 'minimum' : 'ringkasan');
      return;
    }
    setBusy(true);
    setServerError(null);
    let message: string | null;
    try {
      message = await onSave({
        expectedUpdatedAt: settings.updatedAt,
        alert: { enabled, ...lists, digestHour, intervalDays },
        defaults: changed,
      });
    } catch {
      message = 'Gagal menyimpan konfigurasi stiker';
    }
    setBusy(false);
    setServerError(message);
  }

  return {
    settings,
    users,
    busy,
    serverError,
    errors,
    hasMinimumError: Object.keys(errors).some((key) => key.startsWith('default-')),
    hasDigestError: Object.keys(errors).some((key) => !key.startsWith('default-')),
    submit,
    defaults,
    setDefault: (typeId: string, value: string) => {
      setDefaults((current) => ({ ...current, [typeId]: value }));
      fail(`default-${typeId}`, undefined);
    },
    enabled,
    setEnabled,
    hour,
    setHour: (value: string) => {
      setHour(value);
      fail('digestHour', undefined);
    },
    intervalText,
    setIntervalText: (value: string) => {
      setIntervalText(value);
      fail('intervalDays', undefined);
    },
    lists,
    setLists: (next: typeof lists) => {
      setLists(next);
      fail('recipients', undefined);
    },
    suggestions,
  };
}

type StickerSettingsForm = ReturnType<typeof useStickerSettingsForm>;

/**
 * Isian di luar elemen `<form>` (tab "Minimum stok" dan "Ringkasan stok" satu form tetapi terpisah panel): atribut
 * `form` mengaitkannya agar Enter di kolom isian tetap mengirim form yang benar.
 */
function MinimumSection({ form }: { form: StickerSettingsForm }) {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-base font-semibold">Minimum stok bawaan per jenis</h2>
      <p className="text-sm text-muted-foreground">
        Dipakai sebagai batas minimum stiker baru pada jenis itu (0 = tanpa peringatan). Stiker yang
        sudah ada tidak berubah. Untuk jenis Manual Book, stiker versi pertama memakai nilai ini.
      </p>
      <ul className="divide-y rounded-md border">
        {form.settings.types.map((type) => (
          <li key={type.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="flex items-center gap-2">
              <Label htmlFor={`default-${type.id}`} className="font-medium">
                {`Minimum bawaan ${type.name}`}
              </Label>
              {type.systemKind !== '' ? (
                <Badge variant="outline" color="primary">
                  Sistem
                </Badge>
              ) : null}
            </div>
            <div className="space-y-1">
              <Input
                id={`default-${type.id}`}
                form={STICKER_SETTINGS_FORM_ID}
                type="number"
                inputMode="numeric"
                min={0}
                max={STICKER_LIMITS.qtyMax}
                step={1}
                className="w-32"
                value={form.defaults[type.id] ?? ''}
                aria-invalid={form.errors[`default-${type.id}`] ? true : undefined}
                onChange={(event) => form.setDefault(type.id, event.target.value)}
              />
              {form.errors[`default-${type.id}`] ? (
                <p role="alert" className="text-sm text-destructive-text">
                  {form.errors[`default-${type.id}`]}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DigestSection({ form }: { form: StickerSettingsForm }) {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-base font-semibold">Ringkasan harian stok menipis dan habis</h2>
      <p className="text-sm text-muted-foreground">
        Bagian "Habis": stiker aktif yang total stok semua lokasinya 0 atau kurang, apa pun
        minimumnya. Bagian "Menipis": stiker aktif dengan minimum lebih dari 0 yang stoknya di bawah
        atau sama dengan minimum tetapi belum habis (minimum 0 tidak pernah menipis). Stiker
        nonaktif dan stiker usang (deprecated) tidak dihitung.
      </p>
      {form.settings.smtpConfigured ? null : (
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
          checked={form.enabled}
          onCheckedChange={(next) => form.setEnabled(next === true)}
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
          form={STICKER_SETTINGS_FORM_ID}
          aria-required="true"
          type="number"
          inputMode="numeric"
          min={0}
          max={23}
          step={1}
          className="w-24"
          value={form.hour}
          aria-invalid={form.errors.digestHour ? true : undefined}
          onChange={(event) => form.setHour(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Ringkasan dikirim paling awal pada jam ini, hanya bila ada stok yang menipis atau habis.
        </p>
        {form.errors.digestHour ? (
          <p role="alert" className="text-sm text-destructive-text">
            {form.errors.digestHour}
          </p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sticker-alert-interval" required>
          Kirim setiap (hari)
        </Label>
        <Input
          id="sticker-alert-interval"
          form={STICKER_SETTINGS_FORM_ID}
          aria-required="true"
          type="number"
          inputMode="numeric"
          min={1}
          max={STICKER_LIMITS.alertIntervalDaysMax}
          step={1}
          className="w-24"
          value={form.intervalText}
          aria-invalid={form.errors.intervalDays ? true : undefined}
          onChange={(event) => form.setIntervalText(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          1 = tiap hari selama masih ada stok menipis atau habis; 7 = paling banyak sekali seminggu.
        </p>
        {form.errors.intervalDays ? (
          <p role="alert" className="text-sm text-destructive-text">
            {form.errors.intervalDays}
          </p>
        ) : null}
      </div>
      <MailListsFields
        idPrefix="sticker-alert"
        value={form.lists}
        onChange={form.setLists}
        suggestions={form.suggestions}
        max={STICKER_LIMITS.alertRecipientsMax}
        errors={{ recipients: form.errors.recipients }}
      />
    </section>
  );
}

export interface StickerSettingsPageProps {
  settings: StickerSettingsDto;
  postelSettings: PostelSettingsDto;
  /** Daftar user untuk saran penerima; `null` bila pengguna tak boleh melihat Akses (email bebas tetap dapat diisi). */
  users: readonly UserDto[] | null;
  /** Mengembalikan pesan galat (tampil di halaman) atau `null` bila berhasil. */
  onSave: (input: SaveStickerSettingsInput) => Promise<string | null>;
  onSavePostel: (input: SavePostelSettingsInput) => Promise<string | null>;
  /** Tab aktif (search param di rute); tanpa ini halaman memegangnya sendiri. */
  tab?: SettingsTab | undefined;
  onTabChange?: ((tab: SettingsTab) => void) | undefined;
  onCancel: () => void;
}

/**
 * Konfigurasi Stiker (`sticker: manage`) di `FormPage` + `FormTabs`: "Minimum stok" dan "Ringkasan stok" satu form
 * (`STICKER_ALERT`, `sticker-settings`), "Peringatan Postel" form sendiri (`postel-alert-settings`). Tombol Simpan di
 * bar judul mengikuti tab aktif; isian semua tab tetap hidup saat berpindah tab (panel hanya disembunyikan).
 */
export function StickerSettingsPage({
  settings,
  postelSettings,
  users,
  onSave,
  onSavePostel,
  tab,
  onTabChange,
  onCancel,
}: StickerSettingsPageProps) {
  const [localTab, setLocalTab] = useState<SettingsTab>('minimum');
  const active = tab ?? localTab;
  const changeTab = (next: SettingsTab) => {
    setLocalTab(next);
    onTabChange?.(next);
  };
  const form = useStickerSettingsForm({ settings, users, onSave, onInvalid: changeTab });
  const [postelBusy, setPostelBusy] = useState(false);
  const [postelError, setPostelError] = useState(false);
  const onPostelTab = active === 'postel';

  return (
    <FormPage
      formId={onPostelTab ? POSTEL_ALERT_FORM_ID : STICKER_SETTINGS_FORM_ID}
      title="Konfigurasi Stiker"
      onCancel={onCancel}
      submitting={onPostelTab ? postelBusy : form.busy}
    >
      {/* Form pengaturan stok sengaja kosong: isian di dua panel tab terkait lewat atribut `form`. */}
      <form
        id={STICKER_SETTINGS_FORM_ID}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit();
        }}
      />
      {form.serverError && !onPostelTab ? (
        <p role="alert" className="mb-3 text-sm text-destructive-text">
          {form.serverError}
        </p>
      ) : null}
      <FormTabs
        value={active}
        onValueChange={(id) => changeTab(id as SettingsTab)}
        tabs={[
          {
            id: 'minimum',
            label: 'Minimum stok',
            hasError: form.hasMinimumError,
            content: <MinimumSection form={form} />,
          },
          {
            id: 'ringkasan',
            label: 'Ringkasan stok',
            hasError: form.hasDigestError,
            content: <DigestSection form={form} />,
          },
          {
            id: 'postel',
            label: 'Peringatan Postel',
            hasError: postelError,
            content: (
              <PostelAlertSettings
                formId={POSTEL_ALERT_FORM_ID}
                settings={postelSettings}
                users={users}
                onSave={onSavePostel}
                onBusyChange={setPostelBusy}
                onHasErrorChange={setPostelError}
              />
            ),
          },
        ]}
      />
    </FormPage>
  );
}
