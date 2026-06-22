export const LEAVE_STATUS = {
  PENDING_FIELD_MANAGER: 'pending_field_manager',
  PENDING_BOSS:          'pending_boss',
  CALLBACK_REQUESTED:    'callback_requested',
  APPROVED:              'approved',
  REJECTED:              'rejected',
}

export const LEAVE_STATUS_META = {
  pending_field_manager: {
    label: 'Awaiting Site Incharge',
    pill:  'bg-violet-100 text-violet-800 ring-violet-200',
  },
  pending_boss: {
    label: 'Awaiting Boss',
    pill:  'bg-sky-100 text-sky-800 ring-sky-200',
  },
  callback_requested: {
    label: 'Callback requested',
    pill:  'bg-amber-100 text-amber-800 ring-amber-200',
  },
  approved: {
    label: 'Approved',
    pill:  'bg-emerald-100 text-emerald-800 ring-emerald-200',
  },
  rejected: {
    label: 'Rejected',
    pill:  'bg-rose-100 text-rose-800 ring-rose-200',
  },
}
