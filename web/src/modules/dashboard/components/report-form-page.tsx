import {
  type DashboardReportDto,
  REPORT_LIMITS,
  type ReportPeriod,
  type ReportSchedule,
  type SaveDashboardReportInput,
  validateSchedule,
} from '@shared/dashboard-report';
import { isPostelRecipient } from '@shared/postel';
import { type FormEvent, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { FormPage } from '@/components/page/form-page';
import { FormTabs } from '@/components/page/form-tabs';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { useMe } from '@/modules/auth/use-me';
import { isStaleSaveError, STALE_SAVE_MESSAGE } from '@/modules/sticker/lib/stale';
import { visibleWidgetsByGroup } from '../lib/access';
import { useSaveReport } from '../report-queries';
import { ScheduleFields } from './schedule-fields';
import { ScopeEditor, type ScopeEditorValue } from './scope-editor';

export const REPORT_FORM_ID = 'report-form';

const LINK_DAY_PRESETS = [7, 14, 30, 90];
const DEFAULT_SCHEDULE: ReportSchedule = { frequency: 'weekly', hour: 8, weekday: 1, monthDay: 1 };
const FREEZE_NOTE =
  'BU dan lokasi dibekukan saat laporan disimpan. Dikosongkan = semua yang Anda punya hak saat ini; BU atau lokasi yang ditambahkan kemudian tidak ikut sampai laporan disimpan ulang. Isi surel tetap dihitung dari hak Anda saat dikirim.';

type FieldKey = 'name' | 'schedule' | 'period' | 'widgets' | 'recipients' | 'linkDays';
type FieldErrors = Partial<Record<FieldKey, string>>;
const FIELD_KEYS: readonly FieldKey[] = [
  'name',
  'schedule',
  'period',
  'widgets',
  'recipients',
  'linkDays',
];
const TAB_OF: Record<FieldKey, string> = {
  name: 'dasar',
  schedule: 'dasar',
  period: 'dasar',
  widgets: 'isi',
  recipients: 'penerima',
  linkDays: 'tautan',
};

interface FormState {
  name: string;
  schedule: ReportSchedule;
  period: ReportPeriod;
  scope: ScopeEditorValue;
  /**
   * Apakah lokasi juga menyaring widget Serial/Laporan. Dibaca dari laporan tersimpan (bukan diturunkan dari daftar
   * lokasi beku, yang bisa berisi lokasi hak pemilik tanpa pernah dipilih), dan hanya berubah bila pemilik sendiri
   * mengubah pilihan lokasi.
   */
  locationFiltered: boolean;
  recipientsText: string;
  linkDays: string;
}

function initialState(report: DashboardReportDto | undefined): FormState {
  return {
    name: report?.name ?? '',
    schedule: report?.schedule ?? DEFAULT_SCHEDULE,
    period: report?.period ?? 'lastWeek',
    scope: {
      buIds: report?.scope.buIds ?? [],
      locationIds: report?.scope.locationIds ?? [],
      widgets: report?.scope.widgets ?? [],
      offers: report?.scope.offers ?? [],
    },
    locationFiltered: report?.scope.locationFiltered ?? false,
    recipientsText: (report?.recipients ?? []).join('\n'),
    linkDays: String(report?.linkDays ?? REPORT_LIMITS.linkDaysDefault),
  };
}

/** Alamat dari kolom teks: dipisah baris, koma, titik koma, atau spasi; huruf kecil, duplikat dibuang. */
export function parseRecipients(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry !== ''),
    ),
  ];
}

function validate(state: FormState): FieldErrors {
  const errors: FieldErrors = {};
  const name = state.name.trim();
  if (name === '') errors.name = 'Nama wajib diisi';
  else if (name.length > REPORT_LIMITS.nameMax) {
    errors.name = `Nama maksimal ${REPORT_LIMITS.nameMax} karakter`;
  }
  const scheduleProblem = validateSchedule(state.schedule);
  if (scheduleProblem) errors.schedule = scheduleProblem;
  if (state.scope.widgets.length === 0) errors.widgets = 'Pilih minimal satu widget';
  else if (state.scope.widgets.length > REPORT_LIMITS.widgetsMax) {
    errors.widgets = `Maksimal ${REPORT_LIMITS.widgetsMax} widget per laporan`;
  }
  const recipients = parseRecipients(state.recipientsText);
  if (recipients.length === 0) errors.recipients = 'Isi minimal satu alamat surel';
  else if (recipients.length > REPORT_LIMITS.recipientsMax) {
    errors.recipients = `Maksimal ${REPORT_LIMITS.recipientsMax} alamat`;
  } else if (recipients.some((entry) => !isPostelRecipient(entry))) {
    errors.recipients = 'Ada alamat yang tidak sah; tulis satu alamat polos per baris';
  }
  const days = Number(state.linkDays);
  if (!Number.isInteger(days) || days < 1 || days > REPORT_LIMITS.linkDaysMax) {
    errors.linkDays = `Masa berlaku harus 1-${REPORT_LIMITS.linkDaysMax} hari`;
  }
  return errors;
}

/**
 * Bentuk masukan server. Daftar BU/lokasi dikirim apa adanya (maks. `REPORT_LIMITS.scopeIdsMax`): himpunan beku hak
 * pemilik yang besar tidak dikosongkan, jadi pengurangan pilihan pemilik tidak hilang dan simpan ulang tanpa
 * perubahan menghasilkan cakupan yang sama.
 */
export function toInput(
  state: FormState,
  report: DashboardReportDto | undefined,
): SaveDashboardReportInput {
  const { buIds, locationIds } = state.scope;
  return {
    ...(report ? { id: report.id, expectedUpdatedAt: report.updatedAt } : {}),
    name: state.name.trim(),
    schedule: state.schedule,
    period: state.period,
    // Rentang tak dipakai laporan (periode relatif); server menggantinya dengan periode.
    filter: {
      from: '',
      to: '',
      ...(buIds.length > 0 ? { buIds } : {}),
      ...(locationIds.length > 0 ? { locationIds } : {}),
    },
    locationFiltered: state.locationFiltered && locationIds.length > 0,
    widgets: state.scope.widgets,
    offers: state.scope.offers,
    recipients: parseRecipients(state.recipientsText),
    linkDays: Number(state.linkDays),
  };
}

function pickFieldErrors(error: unknown): FieldErrors {
  const result: FieldErrors = {};
  if (!(error instanceof ApiError)) return result;
  for (const key of FIELD_KEYS) {
    const message = error.fields?.[key];
    if (message) result[key] = message;
  }
  return result;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Penerima atau widget berubah (atau laporan baru): menyimpan perlu konfirmasi karena data terkirim keluar. */
function needsConfirmation(state: FormState, report: DashboardReportDto | undefined): boolean {
  if (!report) return true;
  const widgetsNow = state.scope.widgets.map((widget) => widget.id).sort();
  const widgetsBefore = report.scope.widgets.map((widget) => widget.id).sort();
  return (
    !sameList(parseRecipients(state.recipientsText).sort(), [...report.recipients].sort()) ||
    !sameList(widgetsNow, widgetsBefore)
  );
}

export interface ReportFormPageProps {
  /** Ada = ubah; kosong = laporan baru. */
  report?: DashboardReportDto | undefined;
  /** Dipanggil (dan ditunggu) setelah simpan berhasil. */
  onDone: (id: string) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Form laporan terjadwal (`FormPage` + `FormTabs`: Dasar, Isi, Penerima, Tautan). Tombol Simpan di bar judul men-submit
 * form ini lewat `form={formId}`. Simpan memakai CAS (`expectedUpdatedAt` dari saat form dibuka); perubahan penerima
 * atau widget (dan laporan baru) meminta konfirmasi dulu karena isi dikirim ke alamat di luar aplikasi.
 */
export function ReportFormPage({ report, onDone, onCancel }: ReportFormPageProps) {
  const me = useMe();
  const save = useSaveReport();
  const initial = useMemo(() => initialState(report), [report]);
  const [state, setState] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [tab, setTab] = useState('dasar');
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(initial), [state, initial]);
  useUnsavedChanges(dirty && !saved);

  const allowed = visibleWidgetsByGroup(me).flatMap((entry) =>
    entry.widgets.map((meta) => meta.id),
  );
  const editingOthers =
    report !== undefined && me != null && !me.isSuperAdmin && report.owner !== me.email;
  const patch = (next: Partial<FormState>) => setState((prev) => ({ ...prev, ...next }));

  const days = Number(state.linkDays);
  const dayOptions = [
    ...new Set([...LINK_DAY_PRESETS, ...(Number.isInteger(days) && days > 0 ? [days] : [])]),
  ]
    .sort((a, b) => a - b)
    .map((value) => ({ value: String(value), label: `${value} hari` }));

  const send = async () => {
    setConfirming(false);
    setFormError(null);
    try {
      const result = await save.mutateAsync(toInput(state, report));
      setSaved(true);
      toast.success('Laporan disimpan');
      await onDone(result.id);
    } catch (error) {
      if (isStaleSaveError(error)) {
        setFormError(STALE_SAVE_MESSAGE);
        return;
      }
      const picked = pickFieldErrors(error);
      if (Object.keys(picked).length > 0) {
        setErrors(picked);
        const first = FIELD_KEYS.find((key) => picked[key]);
        if (first) setTab(TAB_OF[first]);
        return;
      }
      setFormError(describeError(error));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validate(state);
    setErrors(found);
    const first = FIELD_KEYS.find((key) => found[key]);
    if (first) {
      setTab(TAB_OF[first]);
      return;
    }
    if (needsConfirmation(state, report)) setConfirming(true);
    else void send();
  };

  const recipients = parseRecipients(state.recipientsText);
  const tabs = [
    {
      id: 'dasar',
      label: 'Dasar',
      hasError: Boolean(errors.name || errors.schedule || errors.period),
      content: (
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="report-name" required>
              Nama laporan
            </Label>
            <Input
              id="report-name"
              value={state.name}
              maxLength={REPORT_LIMITS.nameMax}
              aria-required="true"
              aria-invalid={errors.name ? true : undefined}
              onChange={(event) => patch({ name: event.target.value })}
            />
            {errors.name ? (
              <p role="alert" className="text-sm text-destructive-text">
                {errors.name}
              </p>
            ) : null}
          </div>
          <ScheduleFields
            schedule={state.schedule}
            period={state.period}
            onScheduleChange={(schedule) => patch({ schedule })}
            onPeriodChange={(period) => patch({ period })}
            errors={{ schedule: errors.schedule, period: errors.period }}
          />
        </div>
      ),
    },
    {
      id: 'isi',
      label: 'Isi',
      hasError: Boolean(errors.widgets),
      content: (
        <div className="space-y-3">
          {editingOthers ? (
            <Alert color="info">
              <AlertDescription>
                Laporan ini milik {report?.owner}. Cakupan (widget, BU, lokasi) dipertahankan apa
                adanya selama tidak Anda ubah. Bila Anda mengubahnya, semuanya harus dalam hak akses
                Anda; kalau tidak, penyimpanan ditolak dan perubahan cakupan perlu dilakukan pemilik
                laporan atau pengelola yang berhak.
              </AlertDescription>
            </Alert>
          ) : null}
          <ScopeEditor
            value={state.scope}
            onChange={(scope) =>
              setState((prev) => ({
                ...prev,
                scope,
                // Pilihan lokasi diubah pemilik = pembatasan menurut isinya; selain itu nilai tersimpan dipertahankan.
                locationFiltered: sameList(scope.locationIds, prev.scope.locationIds)
                  ? prev.locationFiltered
                  : scope.locationIds.length > 0,
              }))
            }
            allowedWidgetIds={allowed}
            freezeNote={FREEZE_NOTE}
            maxIds={REPORT_LIMITS.scopeIdsMax}
          />
          <p className="text-xs text-muted-foreground">
            {state.scope.widgets.length} dari maksimal {REPORT_LIMITS.widgetsMax} widget dipilih.
          </p>
          {errors.widgets ? (
            <p role="alert" className="text-sm text-destructive-text">
              {errors.widgets}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'penerima',
      label: 'Penerima',
      hasError: Boolean(errors.recipients),
      content: (
        <div className="space-y-3">
          <Alert color="warning">
            <AlertDescription>
              Isi laporan dihitung dari hak Anda dan terkirim ke semua alamat ini, termasuk yang di
              luar perusahaan. Penerima tidak saling melihat alamat. Tidak ada tautan berhenti
              berlangganan: penerima menghubungi Anda untuk berhenti.
            </AlertDescription>
          </Alert>
          <div className="space-y-1.5">
            <Label htmlFor="report-recipients" required>
              Alamat surel penerima
            </Label>
            <Textarea
              id="report-recipients"
              rows={6}
              value={state.recipientsText}
              placeholder="satu alamat per baris"
              aria-required="true"
              aria-invalid={errors.recipients ? true : undefined}
              onChange={(event) => patch({ recipientsText: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {recipients.length} dari maksimal {REPORT_LIMITS.recipientsMax} alamat. Tulis satu
              alamat polos per baris (tanpa nama); huruf besar disamakan dan alamat kembar dibuang.
            </p>
            {errors.recipients ? (
              <p role="alert" className="text-sm text-destructive-text">
                {errors.recipients}
              </p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      id: 'tautan',
      label: 'Tautan',
      hasError: Boolean(errors.linkDays),
      content: (
        <div className="space-y-3">
          <Select
            id="report-link-days"
            label="Masa berlaku tautan"
            required
            keyboardless
            options={dayOptions}
            value={state.linkDays}
            onValueChange={(next) => patch({ linkDays: next })}
            {...(errors.linkDays ? { error: errors.linkDays } : {})}
          />
          <p className="text-xs text-muted-foreground">
            Tiap surel memuat satu tombol "Buka dashboard lengkap" ke tautan publik yang hanya
            menampilkan periode dan cakupan laporan itu. Tautan berlaku sekian hari sejak surel
            dikirim; Anda dapat mencabutnya kapan saja dari halaman laporan.
          </p>
        </div>
      ),
    },
  ];

  return (
    <>
      <FormPage
        formId={REPORT_FORM_ID}
        title={report ? `Ubah laporan: ${report.name}` : 'Tambah laporan terjadwal'}
        onCancel={onCancel}
        submitting={save.isPending}
        busyText="Menyimpan laporan…"
      >
        <form id={REPORT_FORM_ID} onSubmit={submit} noValidate className="space-y-4">
          {formError ? (
            <Alert color="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <FormTabs tabs={tabs} value={tab} onValueChange={setTab} />
        </form>
      </FormPage>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Simpan laporan dan kirim ke {recipients.length} alamat?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Surel laporan berisi data dari hak Anda dan akan dikirim ke semua alamat penerima,
              termasuk yang di luar perusahaan, setiap kali jadwal tiba. Pastikan daftar penerima
              dan widget sudah benar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Periksa lagi</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              Simpan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
