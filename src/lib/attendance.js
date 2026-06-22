export const STATUS = {
  PRESENT: 'present',
  ABSENT: 'absent',
  HALF_DAY: 'half_day',
}

// Display order: P → H → A
export const STATUS_LIST = [
  {
    value: STATUS.PRESENT,
    label: 'Present',
    short: 'P',
    pill: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  },
  {
    value: STATUS.HALF_DAY,
    label: 'Half Day',
    short: 'H',
    pill: 'bg-amber-100 text-amber-800 ring-amber-200',
  },
  {
    value: STATUS.ABSENT,
    label: 'Absent',
    short: 'A',
    pill: 'bg-rose-100 text-rose-800 ring-rose-200',
  },
]

export function statusMeta(value) {
  return STATUS_LIST.find((s) => s.value === value) ?? null
}
