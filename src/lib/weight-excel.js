import * as XLSX from 'xlsx'
import {
  effectiveUnitWeight,
  materialLabel,
} from './weight'

// ============================================================
// Excel export for weight calculations (SheetJS).
//
// Per-row Total is written as a live formula (=UnitWt*Qty) and the
// grand total as =SUM(...), so the figures stay verifiable when the
// sheet is opened. All other cells are computed values.
// ============================================================

// A..O — 15 columns
const HEADERS = [
  'Sr No', 'Description', 'Material Type',
  'L (mm)', 'W (mm)', 'T (mm)', 'OD (mm)', 'ID (mm)', 'Dia (mm)', 'Side A (mm)', 'Side B (mm)',
  'Unit Wt (kg)', 'Qty', 'Total Wt (kg)', 'Remarks',
]

const COL_WIDTHS = [6, 30, 14, 9, 9, 9, 9, 9, 9, 10, 10, 12, 6, 14, 22].map((w) => ({ wch: w }))

function num(v) {
  return v === null || v === undefined || v === '' ? '' : Number(v)
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function safeSheetName(name) {
  // Excel sheet names: ≤31 chars, no : \ / ? * [ ]
  return (name || 'Calculation').replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Calculation'
}

/** Build a worksheet for a single calculation. */
function buildCalcSheet(calc, supervisorName) {
  const items = calc.items || []
  const aoa = [
    ['SASEC ENGINEERING PVT. LTD.'],
    ['Drawing Sheet Weight Calculation'],
    [],
    ['Project:', calc.project_name || '—', '', 'Drawing Ref:', calc.drawing_ref || '—'],
    ['Supervisor:', supervisorName || '—', '', 'Date:', fmtDate(calc.submitted_at || calc.created_at)],
    ['Status:', (calc.status || 'draft') === 'submitted' ? 'Submitted' : 'Draft'],
    [],
    HEADERS,
  ]

  // Write static computed values for every row — no formula dependency so the
  // Total column is always populated even when a spreadsheet app doesn't auto-calc.
  let runningTotal = 0
  for (const it of items) {
    const unitWt = Number(effectiveUnitWeight(it).toFixed(3))
    const qty    = Number(it.quantity) || 0
    const total  = Number((unitWt * qty).toFixed(3))
    runningTotal += total
    const remarkParts = [it.remarks ?? '']
    if (it.needs_review) remarkParts.unshift('⚠ Review thickness')
    aoa.push([
      it.sr_no ?? '',
      it.description ?? '',
      materialLabel(it.material_type),
      num(it.length_mm),
      num(it.width_mm),
      num(it.thickness_mm),
      num(it.outer_diameter_mm),
      num(it.inner_diameter_mm),
      num(it.diameter_mm),
      num(it.side_a_mm),
      num(it.side_b_mm),
      unitWt,                           // col L: Unit Wt (kg)
      qty,                              // col M: Qty
      total,                            // col N: Total Wt (kg) — Qty × unit wt
      remarkParts.filter(Boolean).join(' | '),  // col O: Remarks
    ])
  }

  // Grand total — label at col L (index 11), value at col N (index 13 = TOTAL_CI).
  aoa.push(['', '', '', '', '', '', '', '', '', '', '', 'GRAND TOTAL (kg)',     '', Number(runningTotal.toFixed(3)),            ''])
  aoa.push(['', '', '', '', '', '', '', '', '', '', '', 'GRAND TOTAL (tonnes)', '', Number((runningTotal / 1000).toFixed(4)), ''])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = COL_WIDTHS
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 14 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 14 } },
  ]
  return ws
}

/** Download a single calculation as .xlsx. */
export function exportCalculationToExcel(calc, supervisorName) {
  const wb = XLSX.utils.book_new()
  const ws = buildCalcSheet(calc, supervisorName)
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName(calc.project_name || calc.drawing_ref || 'Calculation'))
  const fname = `SASEC_Weight_${(calc.drawing_ref || calc.project_name || 'calc').replace(/[^\w-]+/g, '_')}.xlsx`
  XLSX.writeFile(wb, fname)
}

/** Download a summary sheet of many submitted calculations (Boss export-all). */
export function exportCalculationsSummaryToExcel(rows) {
  const aoa = [
    ['SASEC ENGINEERING PVT. LTD.'],
    ['Weight Calculation Reports — Submitted'],
    [],
    ['Supervisor', 'Project', 'Drawing Ref', 'Total Wt (kg)', 'Total Wt (tonnes)', 'Submitted'],
  ]
  let grand = 0
  for (const r of rows || []) {
    const kg = Number(r.total_weight_kg) || 0
    grand += kg
    aoa.push([
      r.supervisor_name || 'Supervisor',
      r.project_name || '—',
      r.drawing_ref || '—',
      Number(kg.toFixed(3)),
      Number((kg / 1000).toFixed(4)),
      fmtDate(r.submitted_at || r.created_at),
    ])
  }
  aoa.push([])
  aoa.push(['', '', 'GRAND TOTAL', Number(grand.toFixed(3)), Number((grand / 1000).toFixed(4)), ''])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 22 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }]
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Weight Reports')
  XLSX.writeFile(wb, `SASEC_Weight_Reports_${new Date().toISOString().slice(0, 10)}.xlsx`)
}
