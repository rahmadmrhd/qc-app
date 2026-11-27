import {
  type ClBrand,
  type ClMode,
  type ClSettings,
  parseSettingsFile,
  SETTINGS_PATH,
} from '@shared/countrylock-bundle';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { FormPage } from '@/components/page/form-page';
import { FormSection } from '@/components/page/form-section';
import { FormTabs } from '@/components/page/form-tabs';
import { PageContent } from '@/components/page/page-container';
import { Select } from '@/components/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api/describe-error';
import { isStaleSaveError } from '@/modules/sticker/lib/stale';
import { defaultSettings } from '../lib/default-settings';
import { BRAND_LABELS } from '../lib/labels';
import { fileQueryOptions, filesQueryOptions, useSaveFile } from '../queries';

const FORM_ID = 'cl-settings-form';
const BRANDS: readonly ClBrand[] = ['mikrotik', 'ubiquiti'];
const CONNECT_OPTIONS = [
  { value: 'Target', label: 'Langsung ke target' },
  { value: 'Server', label: 'Lewat server' },
];

/** Bentuk isian form: angka prefix disimpan sebagai teks agar dapat dikosongkan saat mengetik. */
interface Values {
  settings: ClSettings;
  prefix: string;
}

interface Base {
  seq: number;
  updatedAt: string;
}

function toValues(settings: ClSettings): Values {
  return { settings, prefix: String(settings.network.prefixLength) };
}

/** Merakit `settings.json` kanonik dari isian; memvalidasi lewat parser yang sama dengan server. */
function toCanonical(values: Values): { ok: true; text: string } | { ok: false; error: string } {
  const prefix = values.prefix.trim() === '' ? Number.NaN : Number(values.prefix);
  const candidate = {
    ...values.settings,
    network: { ...values.settings.network, prefixLength: prefix },
  };
  const parsed = parseSettingsFile(JSON.stringify(candidate));
  if (!parsed.ok) return parsed;
  return { ok: true, text: `${JSON.stringify(parsed.settings, null, 2)}\n` };
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export interface SettingsFormProps {
  onCancel: () => void;
  /** Dipanggil setelah `settings.json` tersimpan. */
  onDone: () => void;
}

/**
 * Form Pengaturan Router (`FormPage`): router jump, jaringan komputer, dan kredensial/mode tiap merk. Disimpan sebagai
 * `settings.json` kanonik (role `settings`) lewat `clFiles.save` dengan `baseSeq` + `If-Match`; isian divalidasi oleh
 * `parseSettingsFile` yang sama dengan server. Kredensial router tampil apa adanya (keputusan pemilik: bukan rahasia
 * terhadap admin Country Lock). Bila orang lain menyimpan lebih dulu (412) isian TIDAK ditimpa.
 */
export function SettingsForm({ onCancel, onDone }: SettingsFormProps) {
  const list = useQuery(filesQueryOptions());
  const entry = list.data?.find((file) => file.role === 'settings' && !file.removed);
  const detail = useQuery({ ...fileQueryOptions(entry?.id ?? ''), enabled: entry !== undefined });
  const save = useSaveFile();
  const [values, setValues] = useState<Values | null>(null);
  const [initial, setInitial] = useState('');
  const [base, setBase] = useState<Base | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [tab, setTab] = useState('router');
  const dirty = values !== null && JSON.stringify(values) !== initial;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useUnsavedChanges(dirty);

  const missing = list.isSuccess && entry === undefined;
  const parsedServer =
    detail.isSuccess && detail.data.text !== null ? parseSettingsFile(detail.data.text) : null;
  const corruptReason = !detail.isSuccess
    ? null
    : parsedServer === null
      ? 'berkas bukan teks'
      : parsedServer.ok
        ? null
        : parsedServer.error;
  const corrupt = corruptReason !== null;

  // Memasang versi server ke form saat pertama dimuat dan saat berubah selama belum ada suntingan lokal.
  useEffect(() => {
    if (dirtyRef.current) return;
    if (missing) {
      const next = toValues(defaultSettings());
      setValues(next);
      setInitial(JSON.stringify(next));
      setBase(null);
      return;
    }
    const file = detail.data;
    if (!file || file.text === null) return;
    const parsed = parseSettingsFile(file.text);
    if (!parsed.ok) return;
    const next = toValues(parsed.settings);
    setValues(next);
    setInitial(JSON.stringify(next));
    setBase({ seq: file.headRev, updatedAt: file.updatedAt });
  }, [missing, detail.data]);

  if (list.isPending || (entry !== undefined && detail.isPending)) {
    return (
      <PageContent>
        <p className="text-sm text-muted-foreground">Memuat…</p>
      </PageContent>
    );
  }
  if (list.isError || detail.isError || corrupt) {
    return (
      <PageContent className="space-y-4">
        <h1 className="text-2xl font-semibold">Pengaturan Router</h1>
        <Alert color="destructive">
          <AlertDescription>
            {corrupt
              ? `${SETTINGS_PATH} di server tidak dapat dibaca (${corruptReason}). Perbaiki lewat editor berkas atau hubungi pengelola sebelum memakai form ini.`
              : describeError(list.error ?? detail.error)}
          </AlertDescription>
        </Alert>
        <Button variant="outline" color="primary" onClick={onCancel}>
          Kembali
        </Button>
      </PageContent>
    );
  }
  if (values === null) return null;

  const { settings } = values;
  const patch = (fn: (draft: ClSettings) => ClSettings) =>
    setValues({ ...values, settings: fn(settings) });
  const patchMode = (brand: ClBrand, key: 'single' | 'multi', change: Partial<ClMode>) =>
    patch((draft) => ({
      ...draft,
      brands: {
        ...draft.brands,
        [brand]: {
          ...draft.brands[brand],
          modes: {
            ...draft.brands[brand].modes,
            [key]: { ...draft.brands[brand].modes[key], ...change },
          },
        },
      },
    }));
  const patchBrand = (brand: ClBrand, change: Partial<ClSettings['brands'][ClBrand]>) =>
    patch((draft) => ({
      ...draft,
      brands: { ...draft.brands, [brand]: { ...draft.brands[brand], ...change } },
    }));

  const submit = () => {
    const canonical = toCanonical(values);
    if (!canonical.ok) {
      setError(canonical.error);
      return;
    }
    setError(null);
    save.mutate(
      {
        path: SETTINGS_PATH,
        role: 'settings',
        text: canonical.text,
        message: 'Pengaturan router diperbarui',
        ...(base ? { baseSeq: base.seq, expectedUpdatedAt: base.updatedAt } : {}),
      },
      {
        onSuccess: () => {
          setInitial(JSON.stringify(values));
          toast.success('Pengaturan router disimpan');
          onDone();
        },
        onError: (failure) => {
          if (isStaleSaveError(failure)) setStale(true);
          else setError(describeError(failure));
        },
      },
    );
  };

  const reload = async () => {
    const fresh = await detail.refetch();
    const file = fresh.data;
    const parsed = file?.text ? parseSettingsFile(file.text) : null;
    if (file && parsed?.ok) {
      const next = toValues(parsed.settings);
      setValues(next);
      setInitial(JSON.stringify(next));
      setBase({ seq: file.headRev, updatedAt: file.updatedAt });
      setError(null);
    }
    setStale(false);
  };

  const modeFields = (brand: ClBrand, key: 'single' | 'multi') => {
    const mode = settings.brands[brand].modes[key];
    const name = BRAND_LABELS[brand];
    const suffix = `mode ${key} ${name}`;
    return (
      <FormSection title={key === 'single' ? 'Mode single' : 'Mode multi'}>
        {key === 'single' ? (
          <TextField
            id={`cl-${brand}-${key}-ip`}
            label={`IP target ${suffix}`}
            value={mode.ip}
            placeholder="Kosong = diisi saat inject"
            onChange={(value) => patchMode(brand, key, { ip: value })}
          />
        ) : null}
        <TextField
          id={`cl-${brand}-${key}-server`}
          label={`IP server ${suffix}`}
          value={mode.ipServer}
          onChange={(value) => patchMode(brand, key, { ipServer: value })}
        />
        <Select
          id={`cl-${brand}-${key}-via`}
          label={`Koneksi ${suffix}`}
          options={CONNECT_OPTIONS}
          value={mode.connectVia}
          onValueChange={(value) =>
            patchMode(brand, key, { connectVia: value as ClMode['connectVia'] })
          }
        />
        <TextField
          id={`cl-${brand}-${key}-bridge`}
          label={`Bridge ${suffix}`}
          value={mode.interfaceBridge}
          onChange={(value) => patchMode(brand, key, { interfaceBridge: value })}
        />
      </FormSection>
    );
  };

  const brandTab = (brand: ClBrand) => {
    const name = BRAND_LABELS[brand];
    const config = settings.brands[brand];
    return (
      <div className="space-y-6">
        <FormSection title="Kredensial bawaan perangkat">
          <TextField
            id={`cl-${brand}-label`}
            label={`Nama merk ${name}`}
            value={config.label}
            onChange={(value) => patchBrand(brand, { label: value })}
          />
          <TextField
            id={`cl-${brand}-web`}
            label={`Templat tautan web ${name}`}
            value={config.web}
            placeholder="https://{ip}/"
            onChange={(value) => patchBrand(brand, { web: value })}
          />
          <TextField
            id={`cl-${brand}-username`}
            label={`Username bawaan ${name}`}
            value={config.username}
            onChange={(value) => patchBrand(brand, { username: value })}
          />
          <TextField
            id={`cl-${brand}-password`}
            label={`Sandi bawaan ${name}`}
            value={config.password}
            onChange={(value) => patchBrand(brand, { password: value })}
          />
        </FormSection>
        {modeFields(brand, 'single')}
        {modeFields(brand, 'multi')}
      </div>
    );
  };

  const routerTab = (
    <div className="space-y-6">
      <FormSection title="Router jump">
        <TextField
          id="cl-router-ip"
          label="Alamat router jump"
          value={settings.router.ip}
          onChange={(value) =>
            patch((draft) => ({ ...draft, router: { ...draft.router, ip: value } }))
          }
        />
        <TextField
          id="cl-router-bridge"
          label="Nama bridge router"
          value={settings.router.interfaceBridge}
          onChange={(value) =>
            patch((draft) => ({ ...draft, router: { ...draft.router, interfaceBridge: value } }))
          }
        />
        <TextField
          id="cl-router-username"
          label="Username router"
          value={settings.router.username}
          onChange={(value) =>
            patch((draft) => ({ ...draft, router: { ...draft.router, username: value } }))
          }
        />
        <TextField
          id="cl-router-password"
          label="Sandi router"
          value={settings.router.password}
          onChange={(value) =>
            patch((draft) => ({ ...draft, router: { ...draft.router, password: value } }))
          }
        />
      </FormSection>
      <FormSection title="Jaringan komputer">
        <TextField
          id="cl-network-ip"
          label="IP komputer"
          value={settings.network.computerIp}
          onChange={(value) =>
            patch((draft) => ({ ...draft, network: { ...draft.network, computerIp: value } }))
          }
        />
        <TextField
          id="cl-network-prefix"
          label="Panjang prefix jaringan"
          value={values.prefix}
          placeholder="24"
          onChange={(value) => setValues({ ...values, prefix: value })}
        />
      </FormSection>
    </div>
  );

  return (
    <>
      <FormPage
        formId={FORM_ID}
        title="Pengaturan Router"
        onCancel={onCancel}
        submitting={save.isPending}
        submitDisabled={!dirty && base !== null}
      >
        <form
          id={FORM_ID}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {missing ? (
            <Alert color="info">
              <AlertDescription>
                {SETTINGS_PATH} belum ada. Form berisi nilai bawaan; sesuaikan dengan jaringan
                sebenarnya lalu Simpan.
              </AlertDescription>
            </Alert>
          ) : null}
          {error === null ? null : (
            <Alert color="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <FormTabs
            value={tab}
            onValueChange={setTab}
            tabs={[
              { id: 'router', label: 'Router dan jaringan', content: routerTab },
              ...BRANDS.map((brand) => ({
                id: brand,
                label: BRAND_LABELS[brand],
                content: brandTab(brand),
              })),
            ]}
          />
        </form>
      </FormPage>
      <AlertDialog open={stale} onOpenChange={(open) => !open && setStale(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pengaturan diubah orang lain</AlertDialogTitle>
            <AlertDialogDescription>
              Orang lain menyimpan pengaturan baru sejak Anda membuka form ini, jadi isian Anda
              belum disimpan. Isian tetap ada sampai Anda memuat ulang; muat ulang membuangnya dan
              menampilkan versi terbaru.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Tetap di sini</AlertDialogCancel>
            <AlertDialogAction color="destructive" onClick={() => void reload()}>
              Muat ulang (buang suntingan saya)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
