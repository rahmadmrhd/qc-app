import type { SaveSerialSettingsInput, SerialSettingsDto, UserDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { isPostelRecipient } from '@shared/postel';
import { SERIAL_LIMITS } from '@shared/serials';
import { type ReactNode, useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { FormPage } from '@/components/page/form-page';
import { FormTabs } from '@/components/page/form-tabs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MAX = SERIAL_LIMITS.alertRecipientsMax;

/** Id `<form>` email Serial Number rusak (tombol Simpan ada di bar judul `FormPage`, di luar form). */
export const SERIAL_ALERT_FORM_ID = 'serial-alert-settings';
/** Id `<form>` lokasi tim servis (disimpan sendiri, versi CAS terpisah). */
export const SERIAL_SERVICE_FORM_ID = 'serial-service-settings';

export const SERIAL_SETTINGS_TABS = ['email', 'lokasi'] as const;
export type SerialSettingsTab = (typeof SERIAL_SETTINGS_TABS)[number];

export interface SerialSettingsPageProps {
  settings: SerialSettingsDto;
  /** Daftar user untuk saran penerima; `null` bila pengguna tak boleh melihat Akses (email bebas tetap dapat diisi). */
  users: readonly UserDto[] | null;
  /** Mengembalikan pesan galat (tampil di halaman ini) atau `null` bila berhasil. */
  onSave: (input: SaveSerialSettingsInput) => Promise<string | null>;
  /** Tab aktif (search param di rute); tanpa ini halaman memegangnya sendiri. */
  tab?: SerialSettingsTab | undefined;
  onTabChange?: ((tab: SerialSettingsTab) => void) | undefined;
  onCancel: () => void;
  /** Isi tab "Lokasi tim servis": form sendiri yang memakai `formId` dan melaporkan proses simpan. */
  renderServiceTab: (props: { formId: string; onBusyChange: (busy: boolean) => void }) => ReactNode;
}

function userLabel(user: Pick<UserDto, 'name' | 'email'>): string {
  return `${user.name} (${user.email})`;
}

interface BodyProps extends Pick<SerialSettingsPageProps, 'settings' | 'users' | 'onSave'> {
  onBusyChange: (busy: boolean) => void;
  /** Pesan galat simpan; disimpan di luar `Body` agar tetap tampil saat isian dimuat ulang (versi usang). */
  serverError: string | null;
  onServerError: (message: string | null) => void;
}

function Body({ settings, users, onSave, serverError, onServerError, onBusyChange }: BodyProps) {
  const { alert } = settings;
  const [enabled, setEnabled] = useState(alert.enabled);
  const [recipients, setRecipients] = useState<string[]>(alert.recipients);
  const [extra, setExtra] = useState('');
  const [term, setTerm] = useState('');
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(
    enabled !== alert.enabled ||
      recipients.join('|') !== alert.recipients.join('|') ||
      extra.trim() !== '',
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

  function pickRecipients(ids: string[]) {
    if (ids.length > MAX) {
      setRecipientsError(`Maksimal ${MAX} penerima`);
      return;
    }
    setRecipients(ids);
    setRecipientsError(null);
  }

  function addExtra() {
    const email = extra.trim().toLowerCase();
    if (email === '') return;
    if (!isPostelRecipient(email)) {
      setRecipientsError('Format email tidak valid');
      return;
    }
    if (chosen.has(email)) {
      setRecipientsError('Email sudah ada dalam daftar');
      return;
    }
    if (recipients.length >= MAX) {
      setRecipientsError(`Maksimal ${MAX} penerima`);
      return;
    }
    setRecipients([...recipients, email]);
    setExtra('');
    setRecipientsError(null);
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    onBusyChange(true);
    onServerError(null);
    let message: string | null;
    try {
      message = await onSave({
        expectedUpdatedAt: settings.updatedAt,
        alert: { enabled, recipients },
      });
    } catch {
      message = 'Gagal menyimpan pengaturan Serial Number';
    }
    setBusy(false);
    onBusyChange(false);
    onServerError(message);
  }

  return (
    <form
      id={SERIAL_ALERT_FORM_ID}
      noValidate
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 className="text-base font-semibold">Email Serial Number rusak</h2>
      <p className="text-sm text-muted-foreground">
        Saat tim servis menyatakan sebuah Serial Number rusak, email dikirim ke penerima di bawah.
        Isinya Serial Number, item, BU, nomor laporan, lokasi, tanggal, catatan lengkap dari update
        Rusak, dan tautan baca-saja ke laporan (berlaku 60 hari setelah laporan selesai). Daftar ini
        berlaku untuk semua BU.
      </p>
      {settings.smtpConfigured ? null : (
        <p
          role="status"
          className="rounded-md border border-warning-text/35 bg-warning-text/10 p-3 text-sm"
        >
          SMTP belum diatur di server, jadi email tidak akan terkirim sampai SMTP diatur (lihat
          dokumen penyebaran).
        </p>
      )}
      <div className="flex items-center gap-2">
        <Checkbox
          id="serial-alert-enabled"
          checked={enabled}
          onCheckedChange={(value) => setEnabled(value === true)}
        />
        <Label htmlFor="serial-alert-enabled" className="font-normal">
          Kirim email saat Serial Number dinyatakan rusak
        </Label>
      </div>
      <fieldset aria-label="Penerima email" className="m-0 min-w-0 space-y-2 border-0 p-0">
        <LinkMultiField
          id="serial-alert-recipients"
          label="Penerima email"
          placeholder={users === null ? 'Tambahkan email di bawah' : 'Pilih user'}
          value={recipients}
          labelOf={(id) => {
            const user = userByEmail.get(id);
            return user ? userLabel(user) : id;
          }}
          options={options}
          onSearchChange={setTerm}
          searchDebounceMs={0}
          onChange={pickRecipients}
        />
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="serial-alert-extra">Email lain</Label>
            <Input
              id="serial-alert-extra"
              type="email"
              className="w-72"
              value={extra}
              aria-invalid={recipientsError ? true : undefined}
              aria-describedby={recipientsError ? 'serial-alert-recipients-error' : undefined}
              onChange={(event) => setExtra(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addExtra();
                }
              }}
            />
          </div>
          <Button type="button" variant="outline" color="primary" onClick={addExtra}>
            Tambah email
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Maksimal {MAX} penerima; alamat di luar daftar user boleh ditambahkan.
        </p>
        {recipientsError ? (
          <p
            id="serial-alert-recipients-error"
            role="alert"
            className="text-sm text-destructive-text"
          >
            {recipientsError}
          </p>
        ) : null}
      </fieldset>
      {serverError ? (
        <p role="alert" className="text-sm text-destructive-text">
          {serverError}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Pengaturan Serial Number (`serial: manage` pada semua BU) di `FormPage` + `FormTabs`: tab "Email rusak" (saklar dan
 * penerima, daftar global) dan "Lokasi tim servis" (form sendiri, ETag sendiri). Tombol Simpan di bar judul mengikuti tab
 * aktif; isian kedua tab tetap hidup saat berpindah tab. `key` = versi tersimpan: setelah simpan (atau muat ulang karena
 * versi usang) isian mulai dari data server terbaru.
 */
export function SerialSettingsPage({
  tab,
  onTabChange,
  onCancel,
  renderServiceTab,
  ...props
}: SerialSettingsPageProps) {
  const [localTab, setLocalTab] = useState<SerialSettingsTab>('email');
  const active = tab ?? localTab;
  const changeTab = (next: SerialSettingsTab) => {
    setLocalTab(next);
    onTabChange?.(next);
  };
  const [serverError, setServerError] = useState<string | null>(null);
  const [alertBusy, setAlertBusy] = useState(false);
  const [serviceBusy, setServiceBusy] = useState(false);
  const onService = active === 'lokasi';

  return (
    <FormPage
      formId={onService ? SERIAL_SERVICE_FORM_ID : SERIAL_ALERT_FORM_ID}
      title="Pengaturan Serial Number"
      onCancel={onCancel}
      submitting={onService ? serviceBusy : alertBusy}
    >
      <FormTabs
        value={active}
        onValueChange={(id) => changeTab(id as SerialSettingsTab)}
        tabs={[
          {
            id: 'email',
            label: 'Email rusak',
            content: (
              <Body
                key={props.settings.updatedAt}
                {...props}
                serverError={serverError}
                onServerError={setServerError}
                onBusyChange={setAlertBusy}
              />
            ),
          },
          {
            id: 'lokasi',
            label: 'Lokasi tim servis',
            content: renderServiceTab({
              formId: SERIAL_SERVICE_FORM_ID,
              onBusyChange: setServiceBusy,
            }),
          },
        ]}
      />
    </FormPage>
  );
}
