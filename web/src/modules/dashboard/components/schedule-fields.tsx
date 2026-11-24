import {
  REPORT_FREQUENCIES,
  REPORT_FREQUENCY_LABELS,
  REPORT_PERIOD_LABELS,
  REPORT_PERIODS,
  type ReportFrequency,
  type ReportPeriod,
  type ReportSchedule,
  scheduleLabel,
  WEEKDAY_LABELS,
} from '@shared/dashboard-report';
import { Select } from '@/components/select';

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, '0')}.00 WIB`,
}));
const WEEKDAY_OPTIONS = WEEKDAY_LABELS.map((label, index) => ({
  value: String(index + 1),
  label,
}));
const MONTH_DAY_OPTIONS = [
  ...Array.from({ length: 28 }, (_, index) => ({
    value: String(index + 1),
    label: `Tanggal ${index + 1}`,
  })),
  { value: '0', label: 'Akhir bulan' },
];
const FREQUENCY_OPTIONS = REPORT_FREQUENCIES.map((value) => ({
  value,
  label: REPORT_FREQUENCY_LABELS[value],
}));
const PERIOD_OPTIONS = REPORT_PERIODS.map((value) => ({
  value,
  label: REPORT_PERIOD_LABELS[value],
}));

/**
 * Jadwal dan periode laporan: frekuensi, hari (mingguan) atau tanggal (bulanan), jam WIB, dan periode relatif yang
 * dilaporkan. Hanya pilihan tetap (enum), jadi `Select`. Menit tak dipilih: pemeriksa jadwal bangun tiap 5 menit.
 */
export function ScheduleFields({
  schedule,
  period,
  onScheduleChange,
  onPeriodChange,
  errors,
}: {
  schedule: ReportSchedule;
  period: ReportPeriod;
  onScheduleChange: (next: ReportSchedule) => void;
  onPeriodChange: (next: ReportPeriod) => void;
  errors?: { schedule?: string | undefined; period?: string | undefined };
}) {
  const set = (patch: Partial<ReportSchedule>) => onScheduleChange({ ...schedule, ...patch });
  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          id="report-frequency"
          label="Frekuensi"
          required
          keyboardless
          options={FREQUENCY_OPTIONS}
          value={schedule.frequency}
          onValueChange={(next) => set({ frequency: next as ReportFrequency })}
        />
        {schedule.frequency === 'weekly' ? (
          <Select
            id="report-weekday"
            label="Hari"
            required
            keyboardless
            options={WEEKDAY_OPTIONS}
            value={String(schedule.weekday)}
            onValueChange={(next) => set({ weekday: Number(next) })}
          />
        ) : null}
        {schedule.frequency === 'monthly' ? (
          <Select
            id="report-month-day"
            label="Tanggal"
            required
            options={MONTH_DAY_OPTIONS}
            value={String(schedule.monthDay)}
            onValueChange={(next) => set({ monthDay: Number(next) })}
          />
        ) : null}
        <Select
          id="report-hour"
          label="Jam kirim"
          required
          options={HOUR_OPTIONS}
          value={String(schedule.hour)}
          onValueChange={(next) => set({ hour: Number(next) })}
        />
      </div>
      {errors?.schedule ? (
        <p role="alert" className="text-sm text-destructive-text">
          {errors.schedule}
        </p>
      ) : null}
      <Select
        id="report-period"
        label="Periode yang dilaporkan"
        required
        keyboardless
        options={PERIOD_OPTIONS}
        value={period}
        onValueChange={(next) => onPeriodChange(next as ReportPeriod)}
        {...(errors?.period ? { error: errors.period } : {})}
      />
      <p className="text-xs text-muted-foreground">
        Jadwal: {scheduleLabel(schedule)}. Periode selalu hari penuh yang berakhir kemarin; surel
        terkirim paling lambat sekitar 5 menit dari jam jadwal. Laporan baru atau yang jadwalnya
        diubah mulai dari jadwal berikutnya (pakai Kirim uji untuk mencoba segera).
      </p>
    </div>
  );
}
