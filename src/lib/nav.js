import {
  LayoutDashboard,
  UserCog,
  Users,
  Upload,
  ClipboardCheck,
  Users2,
  InboxIcon,
  FileText,
  IndianRupee,
  FileSignature,
  Receipt,
  Fingerprint,
  CalendarOff,
  Wallet,
  Calculator,
  Scale,
} from 'lucide-react'

/**
 * Sidebar navigation per role. Each entry includes a lucide icon.
 */
export const NAV_LINKS = {
  boss: [
    { to: '/boss',                label: 'Dashboard',      icon: LayoutDashboard, end: true },
    { to: '/boss/supervisors',    label: 'Supervisors',    icon: UserCog                    },
    { to: '/boss/workers',        label: 'Workers',        icon: Users                      },
    { to: '/boss/import-workers', label: 'Import Workers', icon: Upload                     },
    { to: '/boss/attendance',     label: 'Attendance',     icon: ClipboardCheck             },
    { to: '/boss/assignments',    label: "Today's Teams",  icon: Users2                     },
    { to: '/boss/advances',       label: 'Advances',       icon: Wallet                     },
    { to: '/boss/requests',       label: 'Requests',       icon: InboxIcon                  },
    { to: '/boss/work-feed',      label: 'Work Feed',      icon: FileText                   },
    { to: '/boss/payroll',        label: 'Payroll',        icon: IndianRupee                },
    { to: '/boss/weight-reports', label: 'Weight Reports', icon: Scale                      },
    { to: '/boss/forms',          label: 'Forms',          icon: FileSignature              },
    { to: '/boss/expenses',       label: 'Expenses',       icon: Receipt                    },
    { to: '/boss/devices',        label: 'Biometric',      icon: Fingerprint                },
  ],
  supervisor: [
    { to: '/supervisor',            label: 'Dashboard',       icon: LayoutDashboard, end: true },
    { to: '/supervisor/attendance', label: 'Mark Attendance', icon: ClipboardCheck             },
    { to: '/supervisor/advances',   label: 'Advances',        icon: Wallet                     },
    { to: '/supervisor/leave',      label: 'Leave Requests',  icon: CalendarOff                },
    { to: '/supervisor/team',       label: "Today's Team",    icon: Users                      },
    { to: '/supervisor/weight',     label: 'Weight Calculator', icon: Calculator               },
    { to: '/supervisor/work-plan',  label: 'Work Plan',       icon: FileText                   },
    { to: '/supervisor/forms',      label: 'Forms',           icon: FileSignature              },
    { to: '/supervisor/expenses',   label: 'Expenses',        icon: Receipt                    },
  ],
}
