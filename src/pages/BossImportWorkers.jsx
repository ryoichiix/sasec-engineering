import { useEffect, useRef, useState } from 'react'
import DashboardShell from '../components/DashboardShell'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/payroll'
import {
  parseWorkbook,
  annotateRows,
  runImport,
  downloadTemplate,
} from '../lib/worker-import'

const STEPS = { UPLOAD: 'upload', PREVIEW: 'preview', IMPORTING: 'importing', SUMMARY: 'summary' }

// Excel MIME types browsers may report for .xlsx / .xls files. Some
// environments report a generic or empty type, so we accept on EITHER a
// matching extension OR a matching MIME type rather than requiring both.
const EXCEL_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/excel',
  'application/x-excel',
  'application/x-msexcel',
])

function isExcelFile(file) {
  const name = String(file?.name ?? '').toLowerCase().trim()
  const byExtension = name.endsWith('.xlsx') || name.endsWith('.xls')
  const byMime = EXCEL_MIME_TYPES.has(file?.type)
  return byExtension || byMime
}

export default function BossImportWorkers() {
  const fileInputRef = useRef(null)

  const [step, setStep] = useState(STEPS.UPLOAD)
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [parseError, setParseError] = useState(null)

  // Parsed + annotated data
  const [entries, setEntries] = useState([])
  const [missing, setMissing] = useState([])

  // Reference data (for dedup + designation matching)
  const [designations, setDesignations] = useState([])
  const [refDataError, setRefDataError] = useState(null)

  // Import progress / result
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState(null)

  // Fetch the current worker list (for duplicate detection) + designations.
  // Returns the fresh data so callers don't have to wait for a state update.
  const loadReferenceData = async () => {
    const [wk, des] = await Promise.all([
      supabase.from('workers').select('full_name, pf_id'),
      supabase.from('designations').select('id, name, wage_type').order('name'),
    ])
    if (wk.error || des.error) {
      setRefDataError((wk.error || des.error).message)
      return { workers: [], designations: [] }
    }
    setRefDataError(null)
    setDesignations(des.data || [])
    return { workers: wk.data || [], designations: des.data || [] }
  }

  // Preload designations on mount (inline async to avoid a synchronous setState).
  useEffect(() => {
    let alive = true
    supabase
      .from('designations')
      .select('id, name, wage_type')
      .order('name')
      .then(({ data, error }) => {
        if (!alive) return
        if (error) setRefDataError(error.message)
        else setDesignations(data || [])
      })
    return () => { alive = false }
  }, [])

  const counts = {
    ready: entries.filter((e) => e.status === 'ready').length,
    duplicate: entries.filter((e) => e.status === 'duplicate').length,
    error: entries.filter((e) => e.status === 'error').length,
  }

  // ── File handling ──────────────────────────────────────────
  const handleFile = async (file) => {
    if (!file) return
    setParseError(null)
    if (!isExcelFile(file)) {
      setParseError('Please upload an Excel file (.xlsx or .xls).')
      return
    }
    try {
      // Make sure dedup runs against the freshest worker list.
      const { workers } = await loadReferenceData()
      const { rows } = await parseWorkbook(file)
      if (rows.length === 0) {
        setParseError('No data rows found in the file.')
        return
      }
      setMissing([])
      setEntries(annotateRows(rows, workers))
      setFileName(file.name)
      setStep(STEPS.PREVIEW)
    } catch (err) {
      setParseError(err?.message || 'Could not read the file.')
    }
  }

  const onInputChange = (e) => {
    const file = e.target.files?.[0]
    handleFile(file)
    e.target.value = '' // allow re-selecting the same file
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  // ── Import ─────────────────────────────────────────────────
  const confirmImport = async () => {
    const ready = entries.filter((e) => e.status === 'ready')
    if (ready.length === 0) return
    setStep(STEPS.IMPORTING)
    setProgress({ done: 0, total: ready.length })

    const res = await runImport({
      entries: ready,
      supabase,
      designations,
      onProgress: (done, total) => setProgress({ done, total }),
    })

    setResult(res)
    setStep(STEPS.SUMMARY)
    // Refresh so a follow-up import sees the newly created workers as duplicates.
    loadReferenceData()
  }

  const reset = () => {
    setStep(STEPS.UPLOAD)
    setEntries([])
    setMissing([])
    setFileName('')
    setParseError(null)
    setResult(null)
    setProgress({ done: 0, total: 0 })
  }

  return (
    <DashboardShell title="Import Workers">
      {refDataError && (
        <p className="mb-4 text-sm text-brand bg-brand-light border border-brand/20 rounded-lg px-4 py-2">
          {refDataError}
        </p>
      )}

      {step === STEPS.UPLOAD && (
        <UploadStep
          dragging={dragging}
          setDragging={setDragging}
          onDrop={onDrop}
          onPick={() => fileInputRef.current?.click()}
          parseError={parseError}
        />
      )}

      {step === STEPS.PREVIEW && (
        <PreviewStep
          fileName={fileName}
          entries={entries}
          counts={counts}
          missing={missing}
          onConfirm={confirmImport}
          onCancel={reset}
        />
      )}

      {step === STEPS.IMPORTING && <ImportingStep progress={progress} />}

      {step === STEPS.SUMMARY && (
        <SummaryStep result={result} counts={counts} onReset={reset} />
      )}

      {/* Hidden input shared across steps */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={onInputChange}
      />
    </DashboardShell>
  )
}

// ── Step 1: Upload ───────────────────────────────────────────
function UploadStep({ dragging, setDragging, onDrop, onPick, parseError }) {
  return (
    <div className="space-y-5">
      <InfoNote />

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          dragging ? 'border-brand bg-brand-light/40' : 'border-slate-300 bg-white'
        }`}
      >
        <UploadIcon />
        <p className="mt-3 text-sm font-medium text-slate-700">
          Drag &amp; drop your Excel file here
        </p>
        <p className="text-xs text-slate-400 mt-1">.xlsx format · first sheet is read</p>

        <button
          type="button"
          onClick={onPick}
          className="mt-5 inline-flex items-center gap-2 bg-brand hover:bg-brand-hover text-white text-sm font-medium px-5 py-2.5 rounded-lg transition"
        >
          Choose file
        </button>

        <div className="mt-4">
          <button
            type="button"
            onClick={downloadTemplate}
            className="text-xs font-medium text-brand hover:underline"
          >
            Download a blank template
          </button>
        </div>
      </div>

      {parseError && (
        <p className="text-sm text-brand bg-brand-light border border-brand/20 rounded-lg px-4 py-2">
          {parseError}
        </p>
      )}
    </div>
  )
}

function InfoNote() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
      <p className="text-sm font-semibold text-slate-800 mb-2">How bulk import works</p>
      <ul className="text-xs text-slate-500 leading-relaxed space-y-1.5 list-disc pl-4">
        <li>
          Supports the <span className="font-medium text-slate-600">SASEC Payment Sheet</span> format
          directly — upload the file as-is, no reformatting needed.
        </li>
        <li>
          Generic files should have columns:{' '}
          <span className="font-medium text-slate-600">Employee Name, PF ID, Designation,
          Wage Amount, Bank Name, Account Number, IFSC Code</span>.
        </li>
        <li>
          Designation codes (e.g. W&nbsp;=&nbsp;Welder, FAB&nbsp;=&nbsp;Fabricator, SUP&nbsp;=&nbsp;Supervisor) are
          resolved automatically. Unknown designations are created.
        </li>
        <li>
          Wage type is inferred: ≥&nbsp;₹3,000&nbsp;→&nbsp;monthly fixed; below&nbsp;→&nbsp;daily rate.
          You can adjust per-worker after import on the Workers page.
        </li>
        <li>
          <span className="font-medium text-slate-600">No login accounts are created.</span>{' '}
          Workers are database records only — they don't sign in to the app.
        </li>
        <li>Workers already present (same name + PF ID) are skipped automatically.</li>
      </ul>
    </div>
  )
}

// ── Step 2: Preview ──────────────────────────────────────────
function PreviewStep({ fileName, entries, counts, missing, onConfirm, onCancel }) {
  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">Preview · {fileName}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {entries.length} row{entries.length !== 1 ? 's' : ''} found. Review before importing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="text-sm font-medium text-slate-600 border border-slate-300 rounded-lg px-4 py-2 hover:bg-slate-50 transition"
          >
            Choose different file
          </button>
          <button
            onClick={onConfirm}
            disabled={counts.ready === 0}
            className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
          >
            Confirm Import ({counts.ready})
          </button>
        </div>
      </div>

      {/* Count chips */}
      <div className="flex flex-wrap gap-2">
        <CountChip tone="emerald" label="Ready" value={counts.ready} />
        <CountChip tone="amber" label="Duplicates (skip)" value={counts.duplicate} />
        <CountChip tone="rose" label="Errors (skip)" value={counts.error} />
      </div>

      {missing.length > 0 && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          Missing expected column{missing.length !== 1 ? 's' : ''}:{' '}
          <span className="font-medium">{missing.join(', ')}</span>. Rows needing these will be skipped.
        </p>
      )}

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 w-12">#</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">PF ID</th>
                <th className="px-4 py-3">Designation</th>
                <th className="px-4 py-3">Wage</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Bank</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">IFSC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e) => {
                const c = e.clean
                return (
                  <tr
                    key={e.index}
                    className={`align-top ${
                      e.status === 'error'
                        ? 'bg-rose-50/40'
                        : e.status === 'duplicate'
                          ? 'bg-amber-50/40'
                          : 'hover:bg-slate-50/60'
                    } transition-colors`}
                  >
                    <td className="px-4 py-3 text-slate-400">{c.row}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={e.status} reason={e.reason} />
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{c.name || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{c.pfId || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{c.designationName || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {formatCurrency(c.wageAmount)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        c.wageType === 'daily_rate'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {c.wageType === 'daily_rate' ? 'Daily' : 'Monthly'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.phoneNumber || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{c.bankName || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{c.accountNumber || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{c.ifsc || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Only the {counts.ready} "Ready" row{counts.ready !== 1 ? 's' : ''} will be imported.
        Duplicates and errored rows are left untouched.
      </p>
    </div>
  )
}

// ── Step 3: Importing ────────────────────────────────────────
function ImportingStep({ progress }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center max-w-md mx-auto">
      <p className="text-sm font-semibold text-slate-800">Importing workers…</p>
      <p className="text-xs text-slate-400 mt-1">
        Saving worker {progress.done} of {progress.total}
      </p>
      <div className="mt-5 h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full bg-brand transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-slate-400 mt-3">Please keep this tab open.</p>
    </div>
  )
}

// ── Step 4: Summary ──────────────────────────────────────────
function SummaryStep({ result, counts, onReset }) {
  const created = result?.created ?? []
  const failed = result?.failed ?? []
  const createdDesignations = result?.createdDesignations ?? []
  const duplicates = counts.duplicate

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard tone="emerald" value={created.length} label="Imported successfully" />
        <StatCard tone="amber" value={duplicates} label="Skipped — duplicates" />
        <StatCard tone="rose" value={failed.length} label="Failed" />
      </div>

      {created.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
          <p className="text-sm font-semibold text-emerald-700 mb-1">
            {created.length} worker{created.length !== 1 ? 's' : ''} imported
          </p>
          <p className="text-xs text-slate-500">
            Each can sign in with their generated email and the default password
            (SASEC + last 4 digits of account number). Set supervisors and fine-tune wages on the{' '}
            <a href="/boss/workers" className="font-medium text-brand hover:underline">Workers</a> page.
          </p>
          {createdDesignations.length > 0 && (
            <p className="text-xs text-slate-500 mt-2">
              New designations created from the file:{' '}
              <span className="font-medium text-slate-600">
                {[...new Set(createdDesignations)].join(', ')}
              </span>{' '}
              — set their wages on the{' '}
              <a href="/boss/designations" className="font-medium text-brand hover:underline">Designations</a> page.
            </p>
          )}
        </div>
      )}

      {failed.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-rose-700">
              {failed.length} row{failed.length !== 1 ? 's' : ''} failed
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {failed.map((f) => (
              <li key={f.index} className="px-5 py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {f.clean.name || '—'}{' '}
                    <span className="text-slate-400 font-normal">· PF {f.clean.pfId || '—'}</span>
                  </p>
                  <p className="text-xs text-rose-600 mt-0.5">{f.reason}</p>
                </div>
                <span className="text-xs text-slate-400 flex-shrink-0">row {f.clean.row}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={onReset}
          className="bg-brand hover:bg-brand-hover text-white text-sm font-medium px-5 py-2 rounded-lg transition"
        >
          Import another file
        </button>
        <a
          href="/boss/workers"
          className="text-sm font-medium text-slate-600 border border-slate-300 rounded-lg px-4 py-2 hover:bg-slate-50 transition"
        >
          Go to Workers
        </a>
      </div>
    </div>
  )
}

// ── Small presentational helpers ─────────────────────────────
function StatusPill({ status, reason }) {
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-medium">
        Ready
      </span>
    )
  }
  const tone =
    status === 'duplicate'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-rose-50 text-rose-700 border-rose-200'
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
        {status === 'duplicate' ? 'Duplicate' : 'Error'}
      </span>
      {reason && <span className="text-xs text-slate-400 max-w-[180px]">{reason}</span>}
    </span>
  )
}

function CountChip({ tone, label, value }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${tones[tone]}`}>
      <span className="font-bold">{value}</span> {label}
    </span>
  )
}

function StatCard({ tone, value, label }) {
  const tones = {
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    rose: 'text-rose-600',
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 text-center">
      <p className={`text-3xl font-bold ${tones[tone]}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-1">{label}</p>
    </div>
  )
}

function UploadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 mx-auto text-slate-300">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
    </svg>
  )
}
