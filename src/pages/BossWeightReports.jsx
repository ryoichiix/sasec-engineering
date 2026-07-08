import { useEffect, useState } from 'react'
import { FileSpreadsheet, X, Scale, Search } from 'lucide-react'
import DashboardShell from '../components/DashboardShell'
import IndustrialLoader from '../components/IndustrialLoader'
import Toast from '../components/Toast'
import {
  fetchSubmittedCalculations, fetchSubmittingSupervisors, getDrawingUrl,
} from '../lib/weight-calculations'
import { exportCalculationToExcel, exportCalculationsSummaryToExcel } from '../lib/weight-excel'
import {
  materialLabel, materialDims, DIM_LABELS, effectiveUnitWeight, rowTotal,
  grandTotalKg, fmtKg, fmtTonnes,
} from '../lib/weight'

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function BossWeightReports() {
  const [rows, setRows] = useState([])
  const [supervisors, setSupervisors] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [selected, setSelected] = useState(null)

  // filters
  const [supervisorId, setSupervisorId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [project, setProject] = useState('')

  useEffect(() => {
    fetchSubmittingSupervisors().then(({ data }) => setSupervisors(data || []))
  }, [])

  // Debounced fetch on any filter change.
  useEffect(() => {
    let active = true
    const t = setTimeout(() => {
      setLoading(true)
      fetchSubmittedCalculations({ supervisorId, startDate, endDate, project: project.trim() })
        .then(({ data, error }) => {
          if (!active) return
          if (error) setToast({ type: 'error', message: error.message })
          else setRows(data || [])
          setLoading(false)
        })
    }, 350)
    return () => { active = false; clearTimeout(t) }
  }, [supervisorId, startDate, endDate, project])

  const totalKg = rows.reduce((s, r) => s + (Number(r.total_weight_kg) || 0), 0)

  const clearFilters = () => {
    setSupervisorId(''); setStartDate(''); setEndDate(''); setProject('')
  }

  return (
    <DashboardShell title="Weight Reports">
      {/* Summary + export all */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <SummaryTile label="Submissions" value={rows.length} />
        <SummaryTile label="Total weight" value={`${fmtKg(totalKg)} kg`} sub={`${fmtTonnes(totalKg)} t`} />
        <button
          onClick={() => exportCalculationsSummaryToExcel(rows)}
          disabled={!rows.length}
          className="ml-auto inline-flex items-center gap-2 border border-[#E2E8F0] hover:bg-slate-50 disabled:opacity-40 text-sm font-medium text-slate-700 px-4 py-2.5 rounded-md transition"
        >
          <FileSpreadsheet className="h-4 w-4 text-[#16A34A]" /> Export All
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Supervisor</label>
          <select
            value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}
            className="w-full px-3 py-2 border border-[#E2E8F0] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
          >
            <option value="">All supervisors</option>
            {supervisors.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
          <input type="date" value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 border border-[#E2E8F0] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
          <input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2 border border-[#E2E8F0] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Project</label>
          <div className="relative">
            <Search className="h-4 w-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Search project…"
              className="w-full pl-8 pr-3 py-2 border border-[#E2E8F0] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#C0272D]"
            />
          </div>
        </div>
        {(supervisorId || startDate || endDate || project) && (
          <button onClick={clearFilters} className="text-xs text-[#C0272D] font-medium justify-self-start hover:underline sm:col-span-2 lg:col-span-4">
            Clear filters
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <IndustrialLoader />
      ) : rows.length === 0 ? (
        <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm px-6 py-16 text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-[#FFF1F1] flex items-center justify-center mb-3">
            <Scale className="h-6 w-6 text-[#C0272D]" />
          </div>
          <p className="text-sm font-semibold text-[#0F172A]">No submitted calculations</p>
          <p className="text-sm text-[#94A3B8] mt-1">Nothing matches the current filters.</p>
        </div>
      ) : (
        <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm overflow-hidden divide-y divide-slate-100">
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelected(r)}
              className="w-full text-left flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#0F172A] truncate">{r.project_name || 'Untitled project'}</p>
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  {r.supervisor_name}{r.drawing_ref ? ` · Dwg ${r.drawing_ref}` : ''} · {fmtDate(r.submitted_at)}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-[#0F172A] tabular-nums">{fmtKg(r.total_weight_kg)} kg</p>
                <p className="text-[11px] text-slate-400 tabular-nums">{fmtTonnes(r.total_weight_kg)} t</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <DetailModal calc={selected} onClose={() => setSelected(null)} />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </DashboardShell>
  )
}

function SummaryTile({ label, value, sub }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-bold text-[#0F172A] tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 tabular-nums">{sub}</p>}
    </div>
  )
}

function DetailModal({ calc, onClose }) {
  const [imgUrl, setImgUrl] = useState(null)
  const items = calc.items || []
  const total = grandTotalKg(items)

  useEffect(() => {
    let active = true
    if (calc.image_path) {
      getDrawingUrl(calc.image_path).then(({ url }) => { if (active) setImgUrl(url) })
    }
    return () => { active = false }
  }, [calc.image_path])

  return (
    <div className="fixed inset-0 z-[55] flex items-end md:items-center justify-center p-0 md:p-6">
      <div className="absolute inset-0 bg-[#0F172A]/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full md:max-w-4xl max-h-[92vh] md:max-h-[88vh] rounded-t-2xl md:rounded-2xl shadow-xl flex flex-col overflow-hidden animate-fade-in-up">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[#0F172A] truncate">{calc.project_name || 'Untitled project'}</h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {calc.supervisor_name}{calc.drawing_ref ? ` · Dwg ${calc.drawing_ref}` : ''} · {fmtDate(calc.submitted_at)}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => exportCalculationToExcel(calc, calc.supervisor_name)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 border border-[#E2E8F0] rounded-md px-2.5 py-1.5 hover:bg-slate-50 transition"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-[#16A34A]" /> Excel
            </button>
            <button onClick={onClose} className="p-2 rounded-md text-slate-400 hover:text-[#0F172A] hover:bg-slate-100" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4">
          {imgUrl && (
            <a href={imgUrl} target="_blank" rel="noreferrer" className="inline-block mb-4">
              <img src={imgUrl} alt="Drawing sheet" className="max-h-48 rounded-lg border border-[#E2E8F0] object-contain bg-[#F8FAFC]" />
            </a>
          )}

          <div className="overflow-x-auto border border-[#E2E8F0] rounded-lg">
            <table className="w-full text-sm" style={{ minWidth: 720 }}>
              <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-2 py-2.5 w-10">Sr</th>
                  <th className="px-2 py-2.5 min-w-[140px]">Description</th>
                  <th className="px-2 py-2.5 w-28">Material</th>
                  <th className="px-2 py-2.5 min-w-[180px]">Dimensions (mm)</th>
                  <th className="px-2 py-2.5 w-14 text-right">Qty</th>
                  <th className="px-2 py-2.5 w-24 text-right">Unit (kg)</th>
                  <th className="px-2 py-2.5 w-24 text-right">Total (kg)</th>
                  <th className="px-2 py-2.5 min-w-[100px]">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it, i) => (
                  <tr key={i} className="align-top">
                    <td className="px-2 py-2 text-slate-500">{it.sr_no ?? i + 1}</td>
                    <td className="px-2 py-2 text-[#0F172A]">{it.description || '—'}</td>
                    <td className="px-2 py-2 text-slate-600">{materialLabel(it.material_type)}</td>
                    <td className="px-2 py-2 text-slate-600">
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                        {materialDims(it.material_type).map((f) => (
                          it[f] != null && it[f] !== '' ? (
                            <span key={f} className="tabular-nums">
                              <span className="text-slate-400">{DIM_LABELS[f]}</span> {it[f]}
                            </span>
                          ) : null
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{Number(it.quantity) || 0}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-600">{effectiveUnitWeight(it).toFixed(3)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-[#0F172A]">{rowTotal(it).toFixed(2)}</td>
                    <td className="px-2 py-2 text-slate-500">{it.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer total */}
        <div className="px-5 py-4 border-t border-slate-100 bg-[#FFF8F8] flex items-center justify-end gap-2">
          <span className="text-xs text-slate-500">Grand total</span>
          <span className="text-xl font-bold text-[#C0272D] tabular-nums">{fmtKg(total)} kg</span>
          <span className="text-xs text-slate-400 tabular-nums">({fmtTonnes(total)} t)</span>
        </div>
      </div>
    </div>
  )
}
