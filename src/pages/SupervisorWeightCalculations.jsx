import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Calculator, Loader2, Trash2, ChevronRight, FileSpreadsheet } from 'lucide-react'
import DashboardShell from '../components/DashboardShell'
import Toast from '../components/Toast'
import { useAuth } from '../contexts/auth-context'
import { fetchMyCalculations, deleteCalculation } from '../lib/weight-calculations'
import { exportCalculationToExcel } from '../lib/weight-excel'
import { fmtKg, fmtTonnes } from '../lib/weight'

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function SupervisorWeightCalculations() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    if (!user?.id) return undefined
    let active = true
    fetchMyCalculations(user.id).then(({ data, error }) => {
      if (!active) return
      if (error) setToast({ type: 'error', message: error.message })
      else setRows(data || [])
      setLoading(false)
    })
    return () => { active = false }
  }, [user?.id])

  const remove = async (e, row) => {
    e.preventDefault(); e.stopPropagation()
    if (!window.confirm('Delete this draft? This cannot be undone.')) return
    setBusyId(row.id)
    const { error } = await deleteCalculation(row.id)
    setBusyId(null)
    if (error) { setToast({ type: 'error', message: error.message }); return }
    setRows((prev) => prev.filter((r) => r.id !== row.id))
    setToast({ type: 'success', message: 'Draft deleted.' })
  }

  const exportRow = (e, row) => {
    e.preventDefault(); e.stopPropagation()
    exportCalculationToExcel(row, profile?.full_name)
  }

  return (
    <DashboardShell title="Weight Calculator">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-xl font-bold text-[#0F172A] tracking-tight">My calculations</h2>
          <p className="text-sm text-slate-500 mt-0.5">Drawing-sheet steel weight estimates.</p>
        </div>
        <button
          onClick={() => navigate('/supervisor/weight/new')}
          className="inline-flex items-center gap-2 bg-[#C0272D] hover:bg-[#A01E23] text-white text-sm font-semibold px-4 py-2.5 rounded-md transition shadow-sm flex-shrink-0"
        >
          <Plus className="h-4 w-4" /> New Calculation
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm px-6 py-16 text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-[#FFF1F1] flex items-center justify-center mb-3">
            <Calculator className="h-6 w-6 text-[#C0272D]" />
          </div>
          <p className="text-sm font-semibold text-[#0F172A]">No calculations yet</p>
          <p className="text-sm text-[#94A3B8] mt-1 mb-5">Start one from a drawing-sheet photo or by entering rows manually.</p>
          <button
            onClick={() => navigate('/supervisor/weight/new')}
            className="inline-flex items-center gap-2 bg-[#C0272D] hover:bg-[#A01E23] text-white text-sm font-semibold px-4 py-2.5 rounded-md transition shadow-sm"
          >
            <Plus className="h-4 w-4" /> New Calculation
          </button>
        </div>
      ) : (
        <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm overflow-hidden divide-y divide-slate-100">
          {rows.map((r) => (
            <Link
              key={r.id}
              to={`/supervisor/weight/${r.id}`}
              className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition group"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-[#0F172A] truncate">{r.project_name || 'Untitled project'}</p>
                  <StatusPill status={r.status} />
                </div>
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  {r.drawing_ref ? `Dwg ${r.drawing_ref} · ` : ''}{fmtDate(r.updated_at)}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-[#0F172A] tabular-nums">{fmtKg(r.total_weight_kg)} kg</p>
                <p className="text-[11px] text-slate-400 tabular-nums">{fmtTonnes(r.total_weight_kg)} t</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={(e) => exportRow(e, r)}
                  className="p-2 rounded-md text-slate-400 hover:text-[#16A34A] hover:bg-slate-100 transition"
                  title="Export Excel"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                </button>
                {r.status === 'draft' && (
                  <button
                    onClick={(e) => remove(e, r)}
                    disabled={busyId === r.id}
                    className="p-2 rounded-md text-slate-400 hover:text-[#EF4444] hover:bg-slate-100 transition disabled:opacity-50"
                    title="Delete draft"
                  >
                    {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                )}
                <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-400" />
              </div>
            </Link>
          ))}
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </DashboardShell>
  )
}

function StatusPill({ status }) {
  const submitted = status === 'submitted'
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full flex-shrink-0 ${
      submitted ? 'bg-[#D1FAE5] text-[#047857]' : 'bg-[#F1F5F9] text-[#64748B]'
    }`}>
      {submitted ? 'Submitted' : 'Draft'}
    </span>
  )
}
