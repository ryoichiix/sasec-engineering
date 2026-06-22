import * as XLSX from 'xlsx'

/**
 * Bulk worker import — profile-only (no auth accounts).
 *
 * Workers cannot log in to the app, so no Supabase auth accounts are created.
 * This module reads an .xlsx file on the frontend, maps columns, deduplicates,
 * and INSERTs rows directly into `profiles` as role='worker'.
 *
 * Two modes are supported transparently:
 *   A) SASEC Payment Sheet layout (Payment Sheet (1).xlsx style)
 *        Row 1: company name
 *        Row 2: month
 *        Row 3+4: combined two-row headers
 *        Data from row 5 onwards
 *   B) Generic header layout — any sheet where the first recognised row
 *      contains the expected column names.
 */

// ── Designation code → human-readable name mapping ──────────
// Codes come from the Desig column of the Payment Sheet.
export const DESIG_CODE_MAP = {
  SUP:      'Supervisor',
  FAB:      'Fabricator',
  DRI:      'Driver',
  SAW:      'Saw Operator',
  ELE:      'Electrician',
  MEC:      'Mechanic',
  FM:       'Foreman',
  SK:       'Skilled Worker',
  'S K':    'Skilled Worker',
  MF:       'Multi-skilled Fitter',
  'M F':    'Multi-skilled Fitter',
  'H O':    'Helper Operator',
  H:        'Helper',
  F:        'Fitter',
  'G/C':    'Gang Contractor',
  GRI:      'Grinder',
  MW:       'Mason/Welder',
  P:        'Painter',
  R:        'Rigger',
  'T/W':    'Tack Welder',
  W:        'Welder',
  WM:       'Watchman',
  COOK:     'Cook',
  K:        'Khalasi',
  SAFETY:   'Safety Officer',
  'A/C':    'Accounts',
  HOD:      'Head of Department',
  Director: 'Director',
}

/** Resolve a raw Desig cell to a canonical designation name. */
export function resolveDesignationCode(raw) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return ''
  // Exact match on code map first (case-sensitive codes like "H" vs "h")
  if (DESIG_CODE_MAP[trimmed]) return DESIG_CODE_MAP[trimmed]
  // Case-insensitive fallback
  const lower = trimmed.toLowerCase()
  const entry = Object.entries(DESIG_CODE_MAP).find(
    ([k]) => k.toLowerCase() === lower
  )
  if (entry) return entry[1]
  // Already a readable name (e.g. "Welder") — return as-is
  return trimmed
}

// ── Column layout constants ──────────────────────────────────
// Payment Sheet fixed column indices (0-based) — rows 3+4 are the headers.
// Updated for Payment Sheet (2).xlsx which adds col 19 (wage type) + col 20 (mobile).
const PS_COL = {
  sno:      0,
  pfId:     1,
  name:     2,
  bank:     3,
  // col 4 = address (branch city — not used)
  account:  5,
  ifsc:     6,
  desig:    7,
  wage:     8,
  // cols 9-18 = attendance/payroll calculations — not imported
  wageType: 19,  // "Daily wage" | "Monthly Salary"
  phone:    20,  // Mobile number
  // cols 9-23 = attendance/payroll — not imported
}

// Names that mark a totals/footer row.
const TOTAL_ROW = /^(grand\s*total|sub\s*total|total)$/i

// ── Generic column synonyms (for non-Payment-Sheet files) ────
const FIELD_DEFS = [
  { key: 'name',      required: true,  synonyms: ['employeename','empname','name','workername','fullname','employee'] },
  { key: 'pfId',      required: false, synonyms: ['pfid','pf','pfno','pfnumber','providentfund','providentfundid'] },
  { key: 'desig',     required: false, synonyms: ['designation','desig','desg','role','jobrole','position','trade'] },
  { key: 'wage',      required: false, synonyms: ['wageamount','wage','amount','salary','rate','wages','individualwage'] },
  { key: 'bankName',  required: false, synonyms: ['bankname','bank'] },
  { key: 'account',   required: false, synonyms: ['bankaccountnumber','accountnumber','accountno','acno','accno','bankaccount','account'] },
  { key: 'ifsc',      required: false, synonyms: ['ifsccode','ifsc'] },
]

function normalizeHeader(h) {
  return String(h ?? '')
    .replace(/\(.*?\)/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function mapColumns(headerCells = []) {
  const colToField = {}
  const mapped = {}
  headerCells.forEach((header, idx) => {
    const norm = normalizeHeader(header)
    if (!norm) return
    const def = FIELD_DEFS.find((f) => !mapped[f.key] && f.synonyms.includes(norm))
    if (def) { colToField[idx] = def.key; mapped[def.key] = String(header).trim() }
  })
  return { colToField, mapped }
}

function combineHeaderRows(main = [], sub = []) {
  const width = Math.max(main.length, sub.length)
  const out = []
  for (let i = 0; i < width; i++) {
    const a = String(main[i] ?? '').trim()
    const b = String(sub[i] ?? '').trim()
    out[i] = b || a
  }
  return out
}

// ── Payment-Sheet detection ──────────────────────────────────

/**
 * Returns true if the sheet looks like the SASEC Payment Sheet:
 *   row[0] contains "SASEC" or row[1] contains "PAYMENT SHEET"
 *   AND row[4] (first data row) has a number in col 0 (S.No.)
 */
function isPaymentSheetLayout(aoa) {
  const row0 = String(aoa[0]?.[0] ?? '').toUpperCase()
  const row1 = String(aoa[1]?.[0] ?? '').toUpperCase()
  const hasHeader = row0.includes('SASEC') || row1.includes('PAYMENT SHEET')
  if (!hasHeader) return false
  // col 0 of first potential data row should be a number (S.No.)
  const firstDataNum = Number(aoa[4]?.[0])
  return !Number.isNaN(firstDataNum) && firstDataNum > 0
}

/** Parse a Payment Sheet row (0-indexed aoa row) into a raw object. */
function parsePaymentSheetRow(cells) {
  return {
    sno:     String(cells[PS_COL.sno]  ?? '').trim(),
    pfId:    String(cells[PS_COL.pfId]  ?? '').trim(),
    name:    String(cells[PS_COL.name]  ?? '').trim(),
    bank:     String(cells[PS_COL.bank]     ?? '').trim(),
    account:  String(cells[PS_COL.account]  ?? '').trim(),
    ifsc:     String(cells[PS_COL.ifsc]     ?? '').trim().toUpperCase(),
    desig:    String(cells[PS_COL.desig]    ?? '').trim(),
    wage:     String(cells[PS_COL.wage]     ?? '').trim(),
    wageType: String(cells[PS_COL.wageType] ?? '').trim(),
    phone:    String(cells[PS_COL.phone]    ?? '').trim(),
  }
}

/**
 * Map the wage type string from the Payment Sheet to the stored enum value.
 * "Daily wage" → 'daily_rate'
 * "Monthly Salary" (or anything else) → 'monthly_fixed'
 */
export function resolveWageType(rawWageType) {
  const v = String(rawWageType ?? '').toLowerCase().trim()
  if (v.includes('daily')) return 'daily_rate'
  if (v.includes('monthly')) return 'monthly_fixed'
  return null // unknown — caller falls back to inferWageType
}

// ── Main parser ──────────────────────────────────────────────

/**
 * Read the first worksheet and return normalised rows.
 * @returns {Promise<{ rows: object[], layout: 'payment_sheet'|'generic' }>}
 */
export async function parseWorkbook(file) {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('The file has no worksheets.')

  const sheet = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: true,
  })
  if (aoa.length === 0) throw new Error('The worksheet is empty.')

  // ── Payment Sheet path ────────────────────────────────────
  if (isPaymentSheetLayout(aoa)) {
    const rows = []
    for (let r = 4; r < aoa.length; r++) {    // data starts at row index 4 (row 5)
      const cells = aoa[r] || []
      const raw = parsePaymentSheetRow(cells)

      // Skip blank, total, or no-name rows
      if (!raw.name || TOTAL_ROW.test(raw.name)) continue
      // Skip rows where S.No. is not a number (e.g. extra header repeats)
      if (raw.sno && Number.isNaN(Number(raw.sno))) continue

      raw._row = r + 1
      rows.push(raw)
    }
    if (rows.length === 0) throw new Error('No worker rows found in the Payment Sheet.')
    return { rows, layout: 'payment_sheet' }
  }

  // ── Generic header-detection path ─────────────────────────
  const MAX_HEADER_SCAN = 12
  let best = null
  const consider = (candidate) => {
    candidate.score = Object.keys(candidate.mapped).length
    if (!best || candidate.score > best.score) best = candidate
  }
  const limit = Math.min(aoa.length, MAX_HEADER_SCAN)
  for (let i = 0; i < limit; i++) {
    const single = mapColumns(aoa[i] || [])
    consider({ ...single, dataStart: i + 1 })
    if (i + 1 < aoa.length) {
      const combined = mapColumns(combineHeaderRows(aoa[i] || [], aoa[i + 1] || []))
      consider({ ...combined, dataStart: i + 2 })
    }
  }
  if (!best || best.score === 0) {
    throw new Error('Could not find expected column headers. Check the file layout.')
  }

  const { colToField, dataStart } = best
  const rows = []
  for (let r = dataStart; r < aoa.length; r++) {
    const cells = aoa[r] || []
    const obj = {}
    let hasValue = false
    for (const [idx, key] of Object.entries(colToField)) {
      const val = String(cells[idx] ?? '').trim()
      obj[key] = val
      if (val) hasValue = true
    }
    if (!hasValue) continue
    if (obj.name !== undefined) {
      const nameRaw = String(obj.name ?? '').trim()
      if (!nameRaw || TOTAL_ROW.test(nameRaw)) continue
    }
    obj._row = r + 1
    rows.push(obj)
  }
  return { rows, layout: 'generic' }
}

// ── Row → clean entry ────────────────────────────────────────

/**
 * Determine wage_type from wage value alone (fallback when designation
 * doesn't have a default). If wage >= 3000 → monthly_fixed, else daily_rate.
 */
function inferWageType(wageNum) {
  return wageNum >= 3000 ? 'monthly_fixed' : 'daily_rate'
}

/**
 * Build a clean, validated entry from a parsed row.
 * Works for both payment_sheet and generic layouts.
 */
export function buildEntry(row) {
  const name       = String(row.name    ?? '').trim()
  const pfId       = String(row.pfId    ?? row.pf_id ?? '').trim()
  const bankName   = String(row.bank    ?? row.bankName ?? '').trim()
  const account    = String(row.account ?? row.accountNumber ?? '').trim()
  const ifsc       = String(row.ifsc    ?? '').trim().toUpperCase()
  const desigRaw   = String(row.desig   ?? row.designation ?? '').trim()
  const wageRaw    = String(row.wage    ?? row.wageAmount ?? '').replace(/,/g, '').trim()
  const wageNum    = wageRaw === '' ? 0 : Number(wageRaw)

  // Phone number (column U in Payment Sheet 2)
  const phoneRaw   = String(row.phone   ?? '').replace(/\D/g, '').trim()
  const phone      = phoneRaw || null

  // Wage type: prefer explicit column T value, fall back to inferring from amount
  const wageTypeRaw = String(row.wageType ?? '').trim()
  const resolvedWageType = resolveWageType(wageTypeRaw) ?? inferWageType(wageNum)

  // Resolve designation code → readable name
  const designationName = resolveDesignationCode(desigRaw)

  let error = null
  if (!name) error = 'Employee Name is required'
  else if (Number.isNaN(wageNum) || wageNum < 0) error = `Wage "${wageRaw}" is not a valid number`

  return {
    clean: {
      name,
      pfId,
      bankName,
      accountNumber: account,
      ifsc,
      designationName,
      wageAmount:    Number.isNaN(wageNum) ? 0 : wageNum,
      wageType:      resolvedWageType,
      phoneNumber:   phone,
      row: row._row,
    },
    error,
  }
}

// ── Deduplication ────────────────────────────────────────────

const dupKey = (name, pfId) =>
  `${String(name ?? '').trim().toLowerCase()}|${String(pfId ?? '').trim().toLowerCase()}`

/**
 * Annotate every parsed row: 'ready' | 'duplicate' | 'error'
 */
export function annotateRows(rows, existingWorkers = []) {
  const existing = new Set(
    existingWorkers
      .filter((w) => w.pf_id)
      .map((w) => dupKey(w.full_name, w.pf_id))
  )
  const seenInFile = new Set()

  return rows.map((row, index) => {
    const { clean, error } = buildEntry(row)
    if (error) {
      return { index, clean, status: 'error', reason: error, raw: row }
    }

    // For duplicates, match on name+pfId (pfId can be blank — then only name)
    const key = clean.pfId
      ? dupKey(clean.name, clean.pfId)
      : `name|${clean.name.toLowerCase()}`

    if (existing.has(key) || seenInFile.has(key)) {
      return { index, clean, status: 'duplicate', reason: 'Already exists (same name + PF ID)', raw: row }
    }
    seenInFile.add(key)
    return { index, clean, status: 'ready', reason: null, raw: row }
  })
}

// ── Import execution ─────────────────────────────────────────

/**
 * Insert worker profiles directly into `profiles` (no auth account created).
 *
 * @param {object}   opts
 * @param {object[]} opts.entries      annotated entries with status 'ready'
 * @param {object}   opts.supabase     Boss Supabase client
 * @param {object[]} opts.designations existing [{ id, name, wage_type }] list
 * @param {(done:number,total:number)=>void} [opts.onProgress]
 * @returns {Promise<{ created: object[], failed: object[], createdDesignations: string[] }>}
 */
export async function runImport({ entries, supabase, designations = [], onProgress }) {
  const created = []
  const failed  = []
  const createdDesignations = []

  // Build a lookup: designation name (lower) → { id, wage_type }
  const desigMap = new Map()
  for (const d of designations) {
    desigMap.set(String(d.name).trim().toLowerCase(), { id: d.id, wageType: d.wage_type })
  }

  const total = entries.length

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const c = entry.clean

    try {
      // 1. Resolve designation id (create if not found).
      //    wage_type comes from the explicit column T value in the row (already
      //    resolved in buildEntry), so we never override it with the designation default.
      let designationId = null
      const wageType = c.wageType   // already resolved from col T (or inferred)

      if (c.designationName) {
        const lookup = c.designationName.toLowerCase()
        if (desigMap.has(lookup)) {
          designationId = desigMap.get(lookup).id
        } else {
          // Auto-create the designation so no data is lost
          const { data: newD, error: dErr } = await supabase
            .from('designations')
            .insert({ name: c.designationName, wage_type: wageType, daily_wage: 0 })
            .select('id, name, wage_type')
            .single()
          if (dErr) {
            // Race / unique conflict — try to fetch existing
            const { data: existD } = await supabase
              .from('designations')
              .select('id, wage_type')
              .ilike('name', c.designationName)
              .maybeSingle()
            if (existD) {
              designationId = existD.id
              desigMap.set(lookup, { id: existD.id, wageType: existD.wage_type })
            }
          } else {
            designationId = newD.id
            desigMap.set(lookup, { id: newD.id, wageType: newD.wage_type })
            createdDesignations.push(newD.name)
          }
        }
      }

      // 2. Insert directly into the workers table — no auth account needed.
      //    crypto.randomUUID() provides the id since there is no auth user.
      const { data: profile, error: insErr } = await supabase
        .from('workers')
        .insert({
          id:                  crypto.randomUUID(),
          full_name:           c.name,
          role:                'worker',
          pf_id:               c.pfId             || null,
          designation_id:      designationId       || null,
          designation_name:    c.designationName   || null,
          individual_wage:     c.wageAmount,
          wage_type:           wageType,
          bank_name:           c.bankName          || null,
          bank_account_number: c.accountNumber     || null,
          bank_ifsc:           c.ifsc              || null,
          phone_number:        c.phoneNumber       || null,
        })
        .select('id, full_name')
        .single()

      if (insErr) {
        failed.push({ ...entry, reason: insErr.message })
      } else {
        created.push({ ...entry, profileId: profile.id })
      }
    } catch (err) {
      failed.push({ ...entry, reason: err?.message ?? String(err) })
    }

    onProgress?.(i + 1, total)
  }

  return { created, failed, createdDesignations }
}

// ── Template download (generic) ──────────────────────────────

export function downloadTemplate() {
  const wb = XLSX.utils.book_new()
  const headers = ['Employee Name', 'PF ID', 'Designation', 'Wage Amount', 'Bank Name', 'Account Number', 'IFSC Code']
  const sample = [
    ['Rajesh Kumar', '12345', 'Welder', '22000', 'SBI', '1234567890', 'SBIN0001234'],
    ['Priya Singh',  '',      'Fitter', '700',   'HDFC','9876543210', 'HDFC0001234'],
  ]
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sample])
  XLSX.utils.book_append_sheet(wb, ws, 'Workers')
  XLSX.writeFile(wb, 'sasec-worker-import-template.xlsx')
}
