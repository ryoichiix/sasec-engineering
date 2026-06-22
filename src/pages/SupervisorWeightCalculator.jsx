import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  Camera, Upload, Sparkles, Plus, Trash2, Save, Send,
  FileSpreadsheet, Loader2, ArrowLeft, X, ImageOff,
  CheckCircle2, AlertTriangle,
} from 'lucide-react'
import DashboardShell from '../components/DashboardShell'
import Toast from '../components/Toast'
import { useAuth } from '../contexts/auth-context'
import {
  MATERIAL_TYPES, materialDims, DIM_LABELS,
  isComputed, effectiveUnitWeight, rowTotal,
  grandTotalKg, blankItem, normalizeItem, fmtKg, fmtTonnes,
} from '../lib/weight'
import { extractTableFromImage } from '../lib/extract-table'
import {
  uploadDrawingImage, getDrawingUrl, saveCalculation, fetchCalculation,
} from '../lib/weight-calculations'
import { exportCalculationToExcel } from '../lib/weight-excel'

export default function SupervisorWeightCalculator() {
  const { id: routeId } = useParams()
  const navigate = useNavigate()
  const { user, profile } = useAuth()

  const [currentId, setCurrentId]   = useState(routeId && routeId !== 'new' ? routeId : null)
  const [projectName, setProjectName] = useState('')
  const [drawingRef, setDrawingRef]   = useState('')
  const [items, setItems]             = useState([])

  const [imageFiles, setImageFiles] = useState([])   // up to 3 photos, sent to Claude separately
  const [imagePath, setImagePath]   = useState(null)
  const [remotePreview, setRemotePreview] = useState(null)

  const [loading, setLoading]           = useState(!!(routeId && routeId !== 'new'))
  const [extracting, setExtracting]     = useState(false)
  const [progressLog, setProgressLog]   = useState([])
  const [extractError, setExtractError] = useState(null)
  const [extractRaw, setExtractRaw]     = useState(null)
  // { rows, sections } banner shown after extraction completes
  const [extractSummary, setExtractSummary] = useState(null)
  const [saving, setSaving]             = useState(false)
  const [submitting, setSubmitting]     = useState(false)
  const [toast, setToast]               = useState(null)

  const cameraRef = useRef(null)
  const uploadRef = useRef(null)

  // ── Load existing calculation ─────────────────────────────
  useEffect(() => {
    if (!routeId || routeId === 'new') return
    let active = true
    fetchCalculation(routeId).then(async ({ data, error }) => {
      if (!active) return
      if (error || !data) {
        setToast({ type: 'error', message: 'Could not load this calculation.' })
        setLoading(false)
        return
      }
      setProjectName(data.project_name || '')
      setDrawingRef(data.drawing_ref || '')
      setItems((data.items || []).map((it, i) => normalizeItem(it, i)))
      setImagePath(data.image_path || null)
      if (data.image_path) {
        const { url } = await getDrawingUrl(data.image_path)
        if (active && url) setRemotePreview(url)
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [routeId])

  // Object URLs for the locally-picked photos, revoked when the set changes.
  const localPreviews = useMemo(
    () => imageFiles.map((f) => URL.createObjectURL(f)),
    [imageFiles],
  )
  useEffect(() => () => localPreviews.forEach((u) => URL.revokeObjectURL(u)), [localPreviews])

  const readOnly       = false
  const total          = grandTotalKg(items)
  const hasSections    = items.some((it) => it.section)
  const needsReviewCount = items.filter((it) => it.needs_review).length

  // ── Image pick ────────────────────────────────────────────
  const onPickImage = (e) => {
    const picked = Array.from(e.target.files || [])
    e.target.value = ''
    if (picked.length === 0) return
    setImageFiles((prev) => [...prev, ...picked].slice(0, 3)) // keep at most 3
    setImagePath(null)
    setRemotePreview(null)
    setExtractError(null)
    setExtractRaw(null)
    setExtractSummary(null)
  }

  const removePhoto = (idx) => setImageFiles((prev) => prev.filter((_, i) => i !== idx))

  const clearImage = () => {
    setImageFiles([])
    setImagePath(null)
    setRemotePreview(null)
    setExtractError(null)
    setExtractRaw(null)
    setExtractSummary(null)
  }

  // ── Extract ───────────────────────────────────────────────
  const runExtract = async () => {
    if (imageFiles.length === 0) {
      if (remotePreview) {
        setExtractError('Re-upload the photo to run extraction again.')
      }
      return
    }
    setExtracting(true)
    setExtractError(null)
    setExtractRaw(null)
    setExtractSummary(null)
    setProgressLog([])
    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY
      if (!apiKey) throw new Error('Gemini API key not configured. Add VITE_GEMINI_API_KEY to .env.local')

      const extracted = await extractTableFromImage(
        imageFiles,
        apiKey,
        (msg) => setProgressLog((prev) => [...prev, msg]),
      )
      if (extracted.length === 0) {
        setExtractError('No rows could be read from the image. Upload a clearer photo of the table, or enter rows manually.')
      } else {
        setItems(extracted)
        setExtractSummary({ rows: extracted.length })
        setToast({ type: 'success', message: `Extracted ${extracted.length} row${extracted.length === 1 ? '' : 's'}.` })
      }
    } catch (err) {
      setExtractError(err.message || 'Extraction failed. Enter rows manually.')
      if (err.rawResponse) setExtractRaw(err.rawResponse)
    } finally {
      setExtracting(false)
    }
  }

  // ── Item helpers ──────────────────────────────────────────
  const updateItem = (idx, patch) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx))
  const addRow = () => setItems((prev) => [...prev, blankItem(prev.length + 1)])

  // ── Save / submit ─────────────────────────────────────────
  const persist = async (status) => {
    if (status === 'submitted') {
      if (!projectName.trim()) { setToast({ type: 'error', message: 'Enter a project name before submitting.' }); return }
      if (!items.length)        { setToast({ type: 'error', message: 'Add at least one line item before submitting.' }); return }
    }
    const busy = status === 'submitted' ? setSubmitting : setSaving
    busy(true)
    try {
      let path = imagePath
      // Store the first photo as the representative drawing sheet (one image_path
      // column). Setting `path` here also prevents a re-upload on the next save.
      if (imageFiles.length > 0 && !path) {
        const up = await uploadDrawingImage(imageFiles[0], user.id)
        if (up.error) {
          setToast({ type: 'error', message: `Image upload failed: ${up.error.message}` })
          busy(false)
          return
        }
        path = up.path
        setImagePath(path)
      }

      const { data, error } = await saveCalculation({
        id: currentId,
        supervisorId: user.id,
        projectName, drawingRef,
        imagePath: path,
        items, status,
      })
      if (error) {
        setToast({ type: 'error', message: error.message })
        busy(false)
        return
      }
      if (status === 'submitted') {
        setToast({ type: 'success', message: 'Submitted to Director.' })
        setTimeout(() => navigate('/supervisor/weight'), 600)
        return
      }
      if (!currentId && data?.id) {
        setCurrentId(data.id)
        window.history.replaceState(null, '', `/supervisor/weight/${data.id}`)
      }
      setToast({ type: 'success', message: 'Draft saved.' })
    } finally {
      if (status !== 'submitted') busy(false)
    }
  }

  const exportExcel = () => {
    exportCalculationToExcel(
      { project_name: projectName, drawing_ref: drawingRef, items, status: 'draft', created_at: new Date().toISOString() },
      profile?.full_name,
    )
  }

  if (loading) {
    return (
      <DashboardShell title="Weight Calculator">
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell title="Weight Calculator">
      <Link to="/supervisor/weight" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#0F172A] mb-4">
        <ArrowLeft className="h-4 w-4" /> My calculations
      </Link>

      {/* Project / drawing inputs */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-5 md:p-6 mb-6 relative overflow-hidden">
        <span className="absolute left-0 top-0 bottom-0 w-1 bg-[#C0272D]" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Project name</label>
            <input
              type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Conveyor gallery — Phase 2"
              className="w-full px-3.5 py-2.5 border border-[#E2E8F0] rounded-md text-sm placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#C0272D] focus:border-[#C0272D]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Drawing reference no.</label>
            <input
              type="text" value={drawingRef} onChange={(e) => setDrawingRef(e.target.value)}
              placeholder="e.g. SASEC-STR-014-R2"
              className="w-full px-3.5 py-2.5 border border-[#E2E8F0] rounded-md text-sm placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#C0272D] focus:border-[#C0272D]"
            />
          </div>
        </div>
      </div>

      {/* Drawing sheet upload + extract */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-5 md:p-6 mb-6">
        <h3 className="text-base font-bold text-[#0F172A] tracking-tight mb-1">Drawing sheet</h3>
        <p className="text-xs text-slate-500 mb-4">Photograph or screenshot the fabrication table, then upload here. For a large table, add 2–3 photos of different sections — they're merged automatically. JPG, PNG, or WebP.</p>

        {imageFiles.length > 0 ? (
          <div className="flex flex-col gap-4">
            {/* Photo thumbnails */}
            <div className="flex flex-wrap gap-3">
              {localPreviews.map((url, idx) => (
                <div key={idx} className="relative">
                  <img src={url} alt={`Photo ${idx + 1}`} className="h-40 w-40 rounded-lg border border-[#E2E8F0] object-cover bg-[#F8FAFC]" />
                  {imageFiles.length > 1 && (
                    <span className="absolute left-1.5 top-1.5 rounded-md bg-[#0F172A]/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      Photo {idx + 1}
                    </span>
                  )}
                  <button
                    onClick={() => removePhoto(idx)}
                    className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-white border border-[#E2E8F0] shadow flex items-center justify-center text-slate-500 hover:text-[#EF4444]"
                    aria-label={`Remove photo ${idx + 1}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {imageFiles.length < 3 && (
                <button
                  onClick={() => uploadRef.current?.click()}
                  className="h-40 w-40 flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-[#C0272D] hover:text-[#C0272D] transition"
                >
                  <Plus className="h-5 w-5" />
                  <span className="text-xs font-medium">Add photo</span>
                  <span className="text-[10px] text-slate-400">{imageFiles.length}/3</span>
                </button>
              )}
            </div>

            {/* Extract controls */}
            <div className="flex flex-col gap-2 items-start">
              <button
                onClick={runExtract}
                disabled={extracting || imageFiles.length === 0}
                className="inline-flex items-center justify-center gap-2 bg-[#C0272D] hover:bg-[#A01E23] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-md transition shadow-sm"
              >
                {extracting
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Extracting…</>
                  : <><Sparkles className="h-4 w-4" /> {imageFiles.length > 1 ? `Extract Table from ${imageFiles.length} Photos` : 'Extract Table from Image'}</>}
              </button>

              {/* Progress log */}
              {progressLog.length > 0 && (
                <div className="max-w-xs text-xs text-slate-500 space-y-0.5 max-h-40 overflow-y-auto bg-slate-50 border border-[#E2E8F0] rounded-md p-2">
                  {progressLog.map((msg, i) => (
                    <div key={i} className="flex gap-1">
                      <span className="text-slate-300 flex-shrink-0">→</span>
                      <span>{msg}</span>
                    </div>
                  ))}
                </div>
              )}

              {extractError && (
                <p className="text-xs text-[#EF4444] max-w-xs">{extractError}</p>
              )}
              {extractRaw && (
                <details className="mt-1 max-w-sm">
                  <summary className="text-xs text-slate-400 cursor-pointer select-none">Show Claude raw response (debug)</summary>
                  <pre className="mt-1 text-[10px] text-slate-500 bg-slate-50 border border-[#E2E8F0] rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-48">{extractRaw}</pre>
                </details>
              )}

              <button onClick={clearImage} className="text-xs text-slate-400 hover:text-[#EF4444] transition">
                Clear all photos
              </button>
            </div>
          </div>
        ) : remotePreview ? (
          <div className="flex flex-col sm:flex-row gap-4">
            <img src={remotePreview} alt="Stored drawing sheet" className="max-h-64 rounded-lg border border-[#E2E8F0] object-contain bg-[#F8FAFC]" />
            <div className="flex flex-col gap-3">
              <p className="text-xs text-slate-400 max-w-xs">Stored drawing sheet. Re-upload the photo(s) to run extraction again.</p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => cameraRef.current?.click()}
                  className="inline-flex items-center gap-2 border border-[#E2E8F0] hover:border-slate-400 hover:bg-slate-50 text-sm font-medium text-slate-700 px-4 py-3 rounded-md transition"
                >
                  <Camera className="h-4 w-4 text-[#C0272D]" /> Take photo
                </button>
                <button
                  onClick={() => uploadRef.current?.click()}
                  className="inline-flex items-center gap-2 border border-[#E2E8F0] hover:border-slate-400 hover:bg-slate-50 text-sm font-medium text-slate-700 px-4 py-3 rounded-md transition"
                >
                  <Upload className="h-4 w-4 text-[#C0272D]" /> Upload image
                </button>
              </div>
              {extractError && (
                <p className="text-xs text-[#EF4444] max-w-xs">{extractError}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => cameraRef.current?.click()}
              className="inline-flex items-center gap-2 border border-[#E2E8F0] hover:border-slate-400 hover:bg-slate-50 text-sm font-medium text-slate-700 px-4 py-3 rounded-md transition"
            >
              <Camera className="h-4 w-4 text-[#C0272D]" /> Take photo
            </button>
            <button
              onClick={() => uploadRef.current?.click()}
              className="inline-flex items-center gap-2 border border-[#E2E8F0] hover:border-slate-400 hover:bg-slate-50 text-sm font-medium text-slate-700 px-4 py-3 rounded-md transition"
            >
              <Upload className="h-4 w-4 text-[#C0272D]" /> Upload image
            </button>
            <p className="w-full text-xs text-slate-400 flex items-center gap-1.5 mt-1">
              <ImageOff className="h-3.5 w-3.5" /> No file yet — add up to 3 photos, or skip this and enter rows manually below.
            </p>
          </div>
        )}

        <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={onPickImage} />
        <input ref={uploadRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple className="hidden" onChange={onPickImage} />
      </div>

      {/* Review banner */}
      {extractSummary && (
        <div className="flex items-start gap-3 bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl px-4 py-3 mb-6">
          <CheckCircle2 className="h-5 w-5 text-[#16A34A] flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#15803D]">
              {extractSummary.rows} row{extractSummary.rows === 1 ? '' : 's'} extracted
            </p>
            <p className="text-xs text-[#16A34A] mt-0.5">
              Please review and correct any misread values before saving.
              {' '}If rows are missing, scroll down and add them manually or re-upload the image to extract again.
            </p>
            {needsReviewCount > 0 && (
              <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                {needsReviewCount} row{needsReviewCount === 1 ? '' : 's'} flagged ⚠ — weight doesn&apos;t match L × W × T × 7.85 ÷ 1,000,000, or a dimension is missing. Verify before saving.
              </p>
            )}
          </div>
          <button onClick={() => setExtractSummary(null)} className="ml-auto text-[#16A34A] hover:text-[#15803D] flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Items table */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="h-6 w-1 rounded-full bg-[#C0272D]" />
            <h3 className="text-base font-bold text-[#0F172A] tracking-tight">Line items</h3>
            <span className="text-xs text-slate-400">{items.length} row{items.length === 1 ? '' : 's'}</span>
          </div>
          <button
            onClick={addRow}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 border border-[#E2E8F0] rounded-md px-3 py-1.5 hover:bg-slate-50 transition"
          >
            <Plus className="h-3.5 w-3.5" /> Add Row
          </button>
        </div>

        {items.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-[#94A3B8]">
            No rows yet. Extract from an image or PDF above, or use <b>Add Row</b> to start.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: hasSections ? 980 : 900 }}>
              <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-2 py-3 w-12">Sr</th>
                  {hasSections && <th className="px-2 py-3 w-20">Section</th>}
                  <th className="px-2 py-3 min-w-[160px]">Description</th>
                  <th className="px-2 py-3 w-36">Material</th>
                  <th className="px-2 py-3 min-w-[220px]">Dimensions (mm)</th>
                  <th className="px-2 py-3 w-16 text-right">Qty</th>
                  <th className="px-2 py-3 w-28 text-right">Unit Wt (kg)</th>
                  <th className="px-2 py-3 w-28 text-right">Total (kg)</th>
                  <th className="px-2 py-3 min-w-[120px]">Remarks</th>
                  <th className="px-2 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it, idx) => (
                  <ItemRow
                    key={idx}
                    item={it}
                    showSection={hasSections}
                    onChange={(patch) => updateItem(idx, patch)}
                    onRemove={() => removeItem(idx)}
                    readOnly={readOnly}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Grand total */}
        <div className="px-5 py-4 border-t border-slate-100 bg-[#FFF8F8] flex flex-col items-end">
          <p className="text-2xl font-bold text-[#C0272D] tabular-nums leading-none">
            {fmtKg(total)} <span className="text-base font-semibold">kg</span>
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">{fmtTonnes(total)} tonnes</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={addRow}
          className="inline-flex items-center gap-2 border border-[#E2E8F0] hover:bg-slate-50 text-sm font-medium text-slate-700 px-4 py-2.5 rounded-md transition"
        >
          <Plus className="h-4 w-4" /> Add Row
        </button>
        <button
          onClick={() => persist('draft')}
          disabled={saving || submitting}
          className="inline-flex items-center gap-2 border border-[#E2E8F0] hover:bg-slate-50 disabled:opacity-50 text-sm font-medium text-slate-700 px-4 py-2.5 rounded-md transition"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Draft
        </button>
        <button
          onClick={exportExcel}
          disabled={!items.length}
          className="inline-flex items-center gap-2 border border-[#E2E8F0] hover:bg-slate-50 disabled:opacity-40 text-sm font-medium text-slate-700 px-4 py-2.5 rounded-md transition"
        >
          <FileSpreadsheet className="h-4 w-4 text-[#16A34A]" /> Export Excel
        </button>
        <button
          onClick={() => persist('submitted')}
          disabled={saving || submitting}
          className="inline-flex items-center gap-2 bg-[#C0272D] hover:bg-[#A01E23] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 rounded-md transition shadow-sm ml-auto"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit to Director
        </button>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </DashboardShell>
  )
}

// ── Row ──────────────────────────────────────────────────────
function ItemRow({ item, showSection, onChange, onRemove, readOnly }) {
  const dims = materialDims(item.material_type)
  const computed = isComputed(item)
  const manualUnit = !computed

  const setNum = (field, raw) =>
    onChange({ [field]: raw === '' ? null : Number(raw) })

  const rowBg = item.needs_review ? 'bg-amber-50 hover:bg-amber-50' : 'hover:bg-slate-50'

  return (
    <tr className={`${rowBg} align-top`}>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1">
          <input
            value={item.sr_no ?? ''} onChange={(e) => onChange({ sr_no: e.target.value })}
            disabled={readOnly}
            className="w-10 px-1.5 py-1 border border-[#E2E8F0] rounded text-xs text-center focus:outline-none focus:ring-1 focus:ring-[#C0272D]"
          />
          {item.needs_review && (
            <span title="Weight doesn't match L × W × T × 7.85 ÷ 1,000,000 — verify dimensions, quantity, and total." className="text-amber-500 flex-shrink-0">
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      </td>
      {showSection && (
        <td className="px-2 py-2">
          <input
            value={item.section ?? ''} onChange={(e) => onChange({ section: e.target.value })}
            disabled={readOnly} placeholder="—"
            className="w-16 px-1.5 py-1 border border-[#E2E8F0] rounded text-xs font-semibold text-[#C0272D] focus:outline-none focus:ring-1 focus:ring-[#C0272D]"
          />
        </td>
      )}
      <td className="px-2 py-2">
        <input
          value={item.description ?? ''} onChange={(e) => onChange({ description: e.target.value })}
          disabled={readOnly} placeholder="Item description"
          className="w-full px-2 py-1 border border-[#E2E8F0] rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#C0272D]"
        />
      </td>
      <td className="px-2 py-2">
        <select
          value={item.material_type} onChange={(e) => onChange({ material_type: e.target.value })}
          disabled={readOnly}
          className="w-full px-2 py-1 border border-[#E2E8F0] rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-[#C0272D]"
        >
          {MATERIAL_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-wrap gap-1.5">
          {dims.map((field) => {
            const needsThisField = item.needs_review && field === 'thickness_mm' && (item[field] == null || item[field] === 0)
            return (
              <label key={field} className="flex flex-col">
                <span className={`text-[9px] uppercase tracking-wide mb-0.5 ${needsThisField ? 'text-amber-500 font-bold' : 'text-slate-400'}`}>
                  {DIM_LABELS[field]}{needsThisField ? ' ⚠' : ''}
                </span>
                <input
                  type="number" inputMode="decimal" min="0"
                  value={item[field] ?? ''} onChange={(e) => setNum(field, e.target.value)}
                  disabled={readOnly}
                  className={`w-16 px-1.5 py-1 border rounded text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-[#C0272D] ${needsThisField ? 'border-amber-400 bg-amber-50' : 'border-[#E2E8F0]'}`}
                />
              </label>
            )
          })}
        </div>
      </td>
      <td className="px-2 py-2 text-right">
        <input
          type="number" inputMode="numeric" min="0"
          value={item.quantity ?? ''} onChange={(e) => onChange({ quantity: e.target.value === '' ? '' : Number(e.target.value) })}
          disabled={readOnly}
          className="w-14 px-1.5 py-1 border border-[#E2E8F0] rounded text-xs text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-[#C0272D]"
        />
      </td>
      <td className="px-2 py-2 text-right">
        {manualUnit ? (
          <input
            type="number" inputMode="decimal" min="0" step="0.001"
            value={item.unit_weight ?? ''} onChange={(e) => setNum('unit_weight', e.target.value)}
            disabled={readOnly} placeholder="kg/pc"
            className="w-20 px-1.5 py-1 border border-dashed border-slate-300 rounded text-xs text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-[#C0272D]"
            title="Enter unit weight manually"
          />
        ) : (
          <span className="text-xs text-slate-600 tabular-nums" title="Auto-calculated from dimensions">
            {effectiveUnitWeight(item).toFixed(3)}
          </span>
        )}
      </td>
      <td className="px-2 py-2 text-right">
        <span className="text-xs font-semibold text-[#0F172A] tabular-nums">{rowTotal(item).toFixed(2)}</span>
      </td>
      <td className="px-2 py-2">
        <input
          value={item.remarks ?? ''} onChange={(e) => onChange({ remarks: e.target.value })}
          disabled={readOnly} placeholder="—"
          className="w-full px-2 py-1 border border-[#E2E8F0] rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#C0272D]"
        />
      </td>
      <td className="px-2 py-2 text-center">
        <button onClick={onRemove} disabled={readOnly} className="text-slate-300 hover:text-[#EF4444] transition" aria-label="Delete row">
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  )
}
