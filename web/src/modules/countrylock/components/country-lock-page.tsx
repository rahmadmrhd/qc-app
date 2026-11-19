import type { QcBridge } from '@countrylock/bridge-contract';
import type { Brand } from '@countrylock/script-template';
import { canInject } from '@countrylock/session-machine';
import { ClipboardList, FolderOpen, KeyRound, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LinkField } from '@/components/link-field';
import { Select } from '@/components/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { isAuthenticated } from '@/modules/auth/session';
import { AUTO_INJECT_WARNING } from '../lib/auto-inject';
import { tipeOptionsFor } from '../lib/type-firmware';
import { useCatalog } from '../use-catalog';
import { useCountryLock } from '../use-country-lock';
import { useDraftRows } from '../use-draft-rows';
import { useInjectTarget } from '../use-inject-target';
import { useMulti } from '../use-multi';
import { CatalogSyncButton } from './catalog-sync-button';
import { CredentialDialog } from './credential-dialog';
import { DraftSummary } from './draft-summary';
import { InjectProgressDialog } from './inject-progress-dialog';
import { MultiPanel } from './multi-panel';
import { RecordDialog } from './record-dialog';

export { AUTO_INJECT_WARNING };

function StatusBadge({ label, up }: { label: string; up: boolean }) {
  return (
    <Badge color={up ? 'success' : 'destructive'} variant="soft" dot>
      {label}: {up ? 'terhubung' : 'tidak terjangkau'}
    </Badge>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm">{value === '' ? '-' : value}</dd>
    </div>
  );
}

/** Halaman Country Lock mode tunggal; hanya dirender bila jembatan desktop tersedia. */
export function CountryLockPage({
  bridge,
  canRecord = false,
  signedIn = isAuthenticated(),
}: {
  bridge: QcBridge;
  /**
   * Boleh mencatat Serial Number di halaman ini: data pengguna termuat (di dalam AppShell) dan izin `serial: edit`.
   * Tanpa itu draft hanya tampil sebagai ringkasan hanya-baca.
   */
  canRecord?: boolean;
  /** Sudah masuk; hanya menentukan alasan ringkasan draft. Bawaan membaca sesi aplikasi; parameter agar tes tak bergantung sesi global. */
  signedIn?: boolean;
}) {
  const draft = useDraftRows(bridge);
  const {
    state,
    pkg,
    info,
    tipe,
    log,
    loading,
    loadError,
    progress,
    credentialPrompt,
    injectBlocker,
    actions,
  } = useCountryLock(bridge, draft);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [mode, setMode] = useState<'single' | 'multi'>('single');
  // Multi hidup di proses utama (jembatan v9); `useMulti` tetap terpasang di semua mode agar peristiwa inject yang belum
  // dicatat selalu sampai ke draft, juga setelah batch dihentikan.
  const multi = useMulti(bridge, draft);
  const multiRunning = multi.snapshot?.running === true;
  const multiAvailable = multi.supported && pkg?.config.brands.ubiquiti !== undefined;
  const activeMode = multiAvailable ? mode : 'single';
  // Jendela dimuat ulang di tengah batch: kembali ke tampilan Multi.
  useEffect(() => {
    if (multiRunning) setMode('multi');
  }, [multiRunning]);
  // Katalog offline dibaca sekali dan dipakai dropdown Tipe, BU, dan Lokasi di form.
  const catalog = useCatalog(bridge);
  const target = useInjectTarget(catalog.snapshot?.catalog ?? null, tipe?.id ?? null);
  // Tipe hanya ada bila katalog aktif di build ini; tanpa itu Merk dan Firmware dipilih manual seperti biasa.
  const showTipe = catalog.supported && catalog.status?.state !== 'disabled';
  // BU/Lokasi ikut katalog offline (UI ini hanya berjalan di jembatan v8 ke atas, `UI_MIN_BRIDGE_VERSION`).
  const showTarget = showTipe;
  // Semua field yang berlaku wajib terisi sebelum inject, termasuk Auto Inject (keputusan pemilik 2026-11-18).
  const missing = [
    state.brand === null ? 'Merk' : null,
    showTipe && tipe === null ? 'Tipe' : null,
    !state.firmwareCode ? 'Firmware' : null,
    showTarget && target.buId === '' ? 'Business Unit' : null,
    showTarget && target.locationId === '' ? 'Lokasi' : null,
  ].filter((name): name is string => name !== null);
  const formComplete = missing.length === 0;
  const { setForm } = actions;
  const { pendingTarget } = target;
  // BU/lokasi terpilih dicatat di baris draft saat inject sukses, dan kelengkapan form menjaga inject (lewat ref di hook).
  useEffect(
    () => setForm({ target: pendingTarget, complete: formComplete }),
    [setForm, pendingTarget, formComplete],
  );

  function chooseMode(next: 'single' | 'multi') {
    // Auto Inject mode tunggal tak boleh tetap menyala di balik tampilan Multi.
    if (next === 'multi' && state.autoInject) actions.toggleAuto(false);
    setMode(next);
  }

  if (loading) {
    return <p className="p-4 text-sm text-muted-foreground">Memuat paket skrip...</p>;
  }

  const brandEntries = pkg ? Object.values(pkg.config.brands) : [];
  const brandConfig = state.brand ? pkg?.config.brands[state.brand] : undefined;
  const missingDeviceIp = brandConfig !== undefined && brandConfig.single.ip === '';
  const catalogItems = catalog.snapshot?.catalog.items ?? [];
  const tipeItems = tipeOptionsFor(catalogItems, state.brand);
  // Firmware dikunci hanya bila Tipe terpilih punya firmware yang ada di paket (aplikasi lama).
  const firmwareLocked = tipe?.application.ok === true;
  const catalogReady = catalog.snapshot !== null;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Country Lock</h1>
        <div className="flex items-center gap-2">
          {/* Sinkron data offline hanya relevan di halaman ini (keputusan pemilik 2026-11-18). */}
          <CatalogSyncButton bridge={bridge} />
          {pkg && multiAvailable ? (
            <fieldset className="m-0 flex min-w-0 items-center gap-1 border-0 p-0">
              <legend className="sr-only">Mode</legend>
              <Button
                type="button"
                size="sm"
                variant={activeMode === 'single' ? 'default' : 'outline'}
                aria-pressed={activeMode === 'single'}
                disabled={multiRunning}
                onClick={() => chooseMode('single')}
              >
                Tunggal
              </Button>
              <Button
                type="button"
                size="sm"
                variant={activeMode === 'multi' ? 'default' : 'outline'}
                aria-pressed={activeMode === 'multi'}
                disabled={state.injecting}
                onClick={() => chooseMode('multi')}
              >
                Multi-Device
              </Button>
              {multiRunning ? (
                <span className="text-xs text-muted-foreground">Hentikan Multi dulu</span>
              ) : null}
            </fieldset>
          ) : null}
          {pkg ? (
            <Button type="button" variant="outline" onClick={actions.chooseDir}>
              <FolderOpen />
              Ganti folder paket
            </Button>
          ) : null}
        </div>
      </div>

      {loadError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Paket tidak dapat dimuat</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      {!pkg ? (
        <Card>
          <CardHeader>
            <CardTitle>Belum ada paket skrip</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Pilih folder yang berisi <code>config.QC</code> beserta folder skrip per merk
              (misalnya hasil unduhan dari server).
            </p>
            <Button type="button" onClick={actions.chooseDir}>
              <FolderOpen />
              Pilih folder paket
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {pkg.missing.length > 0 ? (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>Berkas skrip tidak ditemukan</AlertTitle>
              <AlertDescription>{pkg.missing.join(', ')}</AlertDescription>
            </Alert>
          ) : null}
          {pkg.warnings.length > 0 ? (
            <Alert>
              <TriangleAlert />
              <AlertTitle>Peringatan konfigurasi</AlertTitle>
              <AlertDescription>{pkg.warnings.join('; ')}</AlertDescription>
            </Alert>
          ) : null}

          {activeMode === 'multi' ? (
            <MultiPanel
              pkg={pkg}
              catalog={catalog.snapshot?.catalog ?? null}
              multi={multi}
              injectBlocker={draft.status === 'loading' ? null : injectBlocker}
            />
          ) : (
            <Card className="w-full max-w-4xl">
              <CardHeader>
                <CardTitle>Perangkat</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  className={showTipe ? 'grid gap-4 sm:grid-cols-3' : 'grid gap-4 sm:grid-cols-2'}
                >
                  <Select
                    id="country-lock-brand"
                    label="Merk"
                    placeholder="Pilih merk"
                    value={state.brand ?? ''}
                    options={brandEntries.map((entry) => ({
                      value: entry.brand,
                      label: entry.label,
                    }))}
                    onValueChange={(value) => actions.select(value as Brand, null)}
                    disabled={state.injecting}
                  />
                  {showTipe ? (
                    <LinkField
                      id="country-lock-tipe"
                      label="Tipe"
                      placeholder={
                        !brandConfig
                          ? 'Pilih merk dulu'
                          : tipeItems.length === 0
                            ? 'Belum ada Tipe di katalog'
                            : 'Pilih tipe'
                      }
                      value={tipe?.id ?? null}
                      options={tipeItems.map((item) => ({ id: item.id, label: item.model }))}
                      onChange={(id) =>
                        actions.selectTipe(tipeItems.find((item) => item.id === id) ?? null)
                      }
                      localFilter
                      disabled={!brandConfig || state.injecting || tipeItems.length === 0}
                    />
                  ) : null}
                  <Select
                    id="country-lock-firmware"
                    label="Firmware"
                    placeholder={brandConfig ? 'Pilih firmware' : 'Pilih merk dulu'}
                    value={state.firmwareCode ?? ''}
                    options={(brandConfig?.firmware ?? []).map((firmware) => ({
                      value: firmware.code,
                      label: firmware.label || firmware.code,
                    }))}
                    onValueChange={(value) => state.brand && actions.select(state.brand, value)}
                    disabled={!brandConfig || state.injecting || firmwareLocked}
                  />
                </div>
                {showTarget ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <LinkField
                      id="country-lock-bu"
                      label="Business Unit"
                      placeholder={
                        !catalogReady
                          ? 'Belum tersinkron'
                          : target.buOptions.length === 0
                            ? 'Tidak ada BU'
                            : 'Pilih BU'
                      }
                      options={target.buOptions}
                      value={target.buId === '' ? null : target.buId}
                      onChange={target.setBu}
                      localFilter
                      disabled={state.injecting || target.buOptions.length === 0}
                    />
                    <LinkField
                      id="country-lock-location"
                      label="Lokasi"
                      placeholder={
                        !catalogReady
                          ? 'Belum tersinkron'
                          : target.locationOptions.length === 0
                            ? 'Tidak ada lokasi'
                            : 'Pilih lokasi'
                      }
                      options={target.locationOptions}
                      value={target.locationId === '' ? null : target.locationId}
                      onChange={target.setLocation}
                      localFilter
                      disabled={state.injecting || target.locationOptions.length === 0}
                    />
                  </div>
                ) : null}
                {tipe && !tipe.application.ok ? (
                  <p className="text-sm text-warning-text">{tipe.application.message}</p>
                ) : null}

                {missingDeviceIp ? (
                  <p className="text-sm text-destructive">
                    IP perangkat mode tunggal belum diatur di config.QC untuk merk ini.
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <StatusBadge label="Perangkat" up={state.devicePingable} />
                  <StatusBadge label="Router jump" up={state.routerPingable} />
                </div>

                <dl className="grid grid-cols-2 gap-3 rounded-md border p-3 sm:grid-cols-4">
                  <InfoItem label="Model" value={info?.model ?? ''} />
                  <InfoItem label="Serial" value={state.serial} />
                  <InfoItem label="Negara" value={info?.country ?? ''} />
                  <InfoItem label="Alamat" value={brandConfig?.single.ip ?? ''} />
                </dl>

                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="country-lock-auto"
                      checked={state.autoInject}
                      onCheckedChange={(checked) => {
                        // Konfirmasi hanya saat dinyalakan; mematikan tanpa konfirmasi.
                        if (checked === true) setConfirmAuto(true);
                        else actions.toggleAuto(false);
                      }}
                    />
                    <Label htmlFor="country-lock-auto">Auto Inject</Label>
                  </div>
                  <Button
                    type="button"
                    onClick={actions.inject}
                    disabled={!canInject(state) || !formComplete || injectBlocker !== null}
                  >
                    Inject
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={actions.openCredentials}
                    disabled={!brandConfig}
                  >
                    <KeyRound />
                    Kredensial
                  </Button>
                </div>
                {injectBlocker !== null && draft.status !== 'loading' ? (
                  <p role="status" className="text-sm text-warning-text">
                    {injectBlocker}
                  </p>
                ) : null}
                {!formComplete ? (
                  <p className="text-sm text-muted-foreground">
                    Wajib diisi sebelum inject: {missing.join(', ')}.
                    {showTipe && !catalogReady
                      ? ' Katalog belum tersinkron: tekan tombol sinkron di kanan atas halaman ini.'
                      : ''}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          )}

          {draft.status === 'loading' ? (
            <p className="text-sm text-muted-foreground">Memuat draft...</p>
          ) : draft.status === 'error' ? null : (
            <DraftSummary
              rows={draft.rows}
              note={
                canRecord
                  ? 'Belum diunggah ke Daftar Serial Number. Hasil inject disimpan di komputer ini.'
                  : `${
                      signedIn
                        ? 'Akun ini tidak punya izin mencatat Serial Number'
                        : 'Masuk dulu untuk mencatat ke Daftar Serial Number'
                    }. Hasil inject disimpan di komputer ini.`
              }
              action={
                canRecord ? (
                  <Button type="button" onClick={() => setRecordOpen(true)}>
                    <ClipboardList />
                    Catat Serial Number
                  </Button>
                ) : null
              }
            />
          )}
        </>
      )}

      <AlertDialog open={confirmAuto} onOpenChange={setConfirmAuto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nyalakan Auto Inject?</AlertDialogTitle>
            <AlertDialogDescription>{AUTO_INJECT_WARNING}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => actions.toggleAuto(true)}>Lanjut</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canRecord && draft.status === 'ready' ? (
        <RecordDialog
          open={recordOpen}
          onOpenChange={setRecordOpen}
          draft={{ rows: draft.rows, replace: draft.replace, saveFailed: draft.saveFailed }}
        />
      ) : null}

      <CredentialDialog
        prompt={credentialPrompt}
        onSubmit={actions.submitCredentials}
        onCancel={actions.dismissCredentials}
      />
      <InjectProgressDialog
        progress={progress}
        log={log}
        onCancel={actions.cancel}
        onClose={actions.closeProgress}
      />
    </div>
  );
}
