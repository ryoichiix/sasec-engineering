// ============================================================
// Drawing-sheet table extraction via Claude vision (image only).
//
// The supervisor photographs or screenshots the fabrication
// weight table and uploads a JPG/PNG/WebP. The image is sent to
// Claude Vision in a single request; the returned rows are
// de-duplicated, normalised, and handed to the editable grid.
//
// HEIC (iPhone) photos are rejected with a visible message —
// the browser can't decode them and Claude won't accept them.
// Images over 5MB are downscaled/recompressed on a canvas first.
//
// Direct browser call; VITE_ANTHROPIC_API_KEY is bundled into
// the client — treat as semi-public, rotate/scope accordingly.
// ============================================================

import { normalizeItem } from './weight'

/**
 * Build the Claude Vision prompt for one photo. When several photos of the
 * same table are uploaded, each is sent separately with a "photo N of M"
 * preamble so the model only reads the section in front of it — the rows are
 * merged and de-duplicated afterwards.
 */
function buildVisionPrompt(photoIndex, photoCount) {
  const multi = photoCount > 1
  const header = multi
    ? `This is photo ${photoIndex + 1} of ${photoCount} of an engineering fabrication weight calculation table.
Extract only the rows visible in THIS photo — the other photos cover other sections of the same table.`
    : 'This is a photograph or screenshot of an engineering fabrication weight calculation table.'

  return `${header}
Extract ALL visible data rows. Return ONLY a valid JSON array — no markdown fences, no explanation, nothing else.

Each object must have exactly these fields (use null for missing values, NEVER invent or guess values):
{
  "sr_no": "item number as string e.g. '1', '9/1', '61/2'",
  "description": "full text from description column including ALL dimensions e.g. 'PL 10 THK x 671 x 200'",
  "material_type": "plate|pipe|solid_rod|flat_bar|angle_iron|other",
  "length_mm": number or null,
  "width_mm": number or null,
  "thickness_mm": number or null,
  "outer_diameter_mm": number or null,
  "inner_diameter_mm": number or null,
  "diameter_mm": number or null,
  "unit_weight": number or null,
  "quantity": number or null,
  "total_weight_kg": number or null,
  "remarks": "string or null"
}

Parsing rules (apply exactly):
- "PL 10 THK x 671 x 200" → material_type="plate", thickness_mm=10, length_mm=671, width_mm=200
- "PL 16 THK x 1238 x 793" → material_type="plate", thickness_mm=16, length_mm=1238, width_mm=793 (read BOTH dimensions from the SAME row — never carry a value from the row above or below)
- "ISMB 200 x 3089" → material_type="other", length_mm=3089
- quantity is a separate column — read it carefully, do not confuse it with a dimension
- Use the TOTAL WT / TOTAL WT IN KG column value directly for total_weight_kg — do not recalculate
- Include sub-items like 9/1, 61/2, 48/3 as separate rows
- If the table is rotated or sideways, rotate your reading accordingly
- Skip header rows and section label rows (CH-1, CH-2, SG-1, MARKING NO etc)
- If no table data is visible return []`
}

// ── Helpers ────────────────────────────────────────────────

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

// ── Smart description parsing ──────────────────────────────
// Fills dimension fields the model left null and flags plates whose
// thickness can't be read. Claude's explicit values always win.

function parseSASECDescription(desc) {
  if (!desc || typeof desc !== 'string') return {}
  const d = desc.trim().toUpperCase()

  // Plate with missing/unreadable thickness: "PL THK x 818 x 750"
  const plNoThkMatch = d.match(/^PL\s+THK\s*[Xx]\s*(\d+(?:\.\d+)?)\s*[Xx]\s*(\d+(?:\.\d+)?)/)
  if (plNoThkMatch) {
    return {
      material_type: 'plate',
      length_mm:     Number(plNoThkMatch[1]),
      width_mm:      Number(plNoThkMatch[2]),
      needs_review:  true,
    }
  }

  // Plate with explicit thickness: PL {T} [THK] x {L} x {W}
  const plMatch = d.match(/^PL\s+(\d+(?:\.\d+)?)\s*(?:THK\s*)?[Xx]\s*(\d+(?:\.\d+)?)\s*[Xx]\s*(\d+(?:\.\d+)?)/)
  if (plMatch) {
    return {
      material_type: 'plate',
      thickness_mm:  Number(plMatch[1]),
      length_mm:     Number(plMatch[2]),
      width_mm:      Number(plMatch[3]),
    }
  }

  // Angle: ISA {A}x{B}x{T}
  const isaMatch = d.match(/^ISA\s+(\d+(?:\.\d+)?)\s*[Xx]\s*(\d+(?:\.\d+)?)\s*[Xx]\s*(\d+(?:\.\d+)?)/)
  if (isaMatch) {
    return {
      material_type: 'angle_iron',
      side_a_mm:     Number(isaMatch[1]),
      side_b_mm:     Number(isaMatch[2]),
      thickness_mm:  Number(isaMatch[3]),
    }
  }

  // Flat bar: FB {W} x {T} x {L}
  const fbMatch = d.match(/^(?:FB|FLAT\s*BAR)\s+(\d+(?:\.\d+)?)\s*[Xx]\s*(\d+(?:\.\d+)?)\s*[Xx]\s*(\d+(?:\.\d+)?)/)
  if (fbMatch) {
    return {
      material_type: 'flat_bar',
      width_mm:      Number(fbMatch[1]),
      thickness_mm:  Number(fbMatch[2]),
      length_mm:     Number(fbMatch[3]),
    }
  }

  if (/^(?:PIPE|TUBE)\b/.test(d)) return { material_type: 'pipe' }

  return {}
}

function applyDescriptionParsing(item) {
  const hints = parseSASECDescription(item.description)
  if (!hints.material_type) return item
  const out = { ...item }
  if (item.material_type === 'other') out.material_type = hints.material_type
  if (hints.needs_review) out.needs_review = true
  const dimFields = ['thickness_mm', 'length_mm', 'width_mm', 'side_a_mm', 'side_b_mm',
                     'outer_diameter_mm', 'inner_diameter_mm', 'diameter_mm']
  for (const f of dimFields) {
    if (hints[f] != null && (item[f] == null || item[f] === 0)) out[f] = hints[f]
  }
  return out
}

/**
 * De-duplicate rows by sr_no (across all uploaded photos). A valid sr_no
 * contains at least one digit and is ≤10 chars — this drops hallucinated
 * word-rows ("SUBTOTAL") and labels. On collision, keep the copy with the
 * most non-null fields. Finally, drop phantom parent rows: if a parent
 * (e.g. "9") has sub-items (9/1, 9/2) AND its description exactly matches
 * one of those sub-items, the parent was hallucinated — remove it.
 */
function deduplicateRows(allRows) {
  const seen = {}
  for (const row of allRows) {
    const key = String(row.sr_no ?? '').trim()
    if (!key || key === 'null' || key === '') continue
    if (!/\d/.test(key)) continue       // must contain at least one digit
    if (key.length > 10) continue       // skip SUBTOTAL, GRAND TOTAL etc

    if (!seen[key]) {
      seen[key] = row
    } else {
      // Keep the row with more non-null fields
      const existingScore = Object.values(seen[key]).filter((v) => v !== null).length
      const newScore = Object.values(row).filter((v) => v !== null).length
      if (newScore > existingScore) seen[key] = row
    }
  }

  const keys = Object.keys(seen)
  const subItemParents = new Set(
    keys.filter((k) => k.includes('/')).map((k) => k.split('/')[0])
  )

  return Object.values(seen).filter((row) => {
    const key = String(row.sr_no)
    if (!subItemParents.has(key)) return true // not a parent, keep it
    // Parent with sub-items — remove only if its description duplicates a sub-item
    const isDuplicate = Object.values(seen).some((r) =>
      String(r.sr_no).startsWith(key + '/') && r.description === row.description
    )
    return !isDuplicate
  })
}

/**
 * Steel-plate formula check. A plate's total weight should equal
 * length × width × thickness × 7.85 ÷ 1,000,000 (kg per piece) × quantity.
 * Returns true when the row needs manual review: a plate with a missing
 * dimension/total, or an extracted total that differs from the formula by
 * more than 3% (a likely mis-read dimension). Non-plate shapes use different
 * formulas and are never flagged here.
 */
function needsFormulaReview(row) {
  const isPlate =
    row.material_type === 'plate' ||
    (row.description || '').toUpperCase().includes('THK')
  if (!isPlate) return false

  const L = Number(row.length_mm)
  const W = Number(row.width_mm)
  const T = Number(row.thickness_mm)
  const extractedTotal = Number(row.total_weight_kg)
  const qty = Number(row.quantity) || 1

  if (!L || !W || !T) return true       // missing dimension → review
  if (!extractedTotal) return true      // no stated total to cross-check → review

  const expectedTotal = (L * W * T * 7.85) / 1_000_000 * qty
  const diff = Math.abs(extractedTotal - expectedTotal) / expectedTotal
  return diff > 0.03
}

/** Downscale + recompress an oversized image on a canvas to fit under maxBytes. */
async function compressImage(file, maxBytes) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      let { width, height } = img

      const maxDim = 3000
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height)
        width = Math.floor(width * scale)
        height = Math.floor(height * scale)
      }

      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)

      canvas.toBlob((blob) => {
        if (blob && blob.size <= maxBytes) {
          resolve(new File([blob], file.name, { type: 'image/jpeg' }))
        } else {
          canvas.toBlob((blob2) => {
            if (blob2) resolve(new File([blob2], file.name, { type: 'image/jpeg' }))
            else reject(new Error('Could not compress image'))
          }, 'image/jpeg', 0.7)
        }
      }, 'image/jpeg', 0.85)
    }
    img.onerror = () => reject(new Error('Could not load image for compression'))
    img.src = url
  })
}

/** Send one image to Claude Vision and return its raw parsed row array. */
async function extractRowsFromOnePhoto(file, apiKey, photoIndex, photoCount, onProgress) {
  const photoLabel = photoCount > 1 ? `photo ${photoIndex + 1} of ${photoCount}` : 'image'
  onProgress?.(`Reading ${photoLabel}…`)

  const fileType = (file.type || '').toLowerCase()
  const ext = (file.name || '').split('.').pop().toLowerCase()

  // iPhone HEIC/HEIF — browser can't decode, Claude won't accept. Reject loudly.
  const isHeic = ext === 'heic' || ext === 'heif' || fileType === 'image/heic' || fileType === 'image/heif'
  if (isHeic) {
    throw new Error(`Photo ${photoIndex + 1} is an iPhone HEIC photo, which isn't supported. Change your iPhone camera to "Most Compatible" (JPEG) under Settings → Camera → Formats, then retake it — or upload a screenshot instead.`)
  }

  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
  if (!validTypes.includes(fileType) && !['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
    throw new Error(`Photo ${photoIndex + 1} has an unsupported type (${file.type || ext}). Please use JPG, PNG, or WebP.`)
  }

  // Claude Vision limit is 5MB per image.
  const maxSize = 5 * 1024 * 1024
  let processed = file
  if (file.size > maxSize) {
    onProgress?.(`Compressing ${photoLabel}…`)
    processed = await compressImage(file, maxSize)
  }

  let base64
  try {
    base64 = await fileToBase64(processed)
  } catch (e) {
    throw new Error(`Could not read photo ${photoIndex + 1}. Please try again.`, { cause: e })
  }

  let mediaType = (processed.type || '').toLowerCase()
  if (!mediaType || mediaType === 'application/octet-stream') {
    mediaType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  }

  onProgress?.(`Sending ${photoLabel} to Claude Vision…`)

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 16000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: buildVisionPrompt(photoIndex, photoCount) },
        ],
      }],
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    let errMsg = `Claude API error on photo ${photoIndex + 1}`
    try {
      const errJson = JSON.parse(errText)
      errMsg = errJson?.error?.message || errMsg
    } catch { /* keep default */ }
    throw new Error(errMsg)
  }

  const data = await response.json()
  const text = data.content?.[0]?.text || ''

  onProgress?.(`Parsing ${photoLabel}…`)

  try {
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    console.error(`[extract-table] JSON parse failed for ${photoLabel}. Response was:`, text.slice(0, 500))
    throw new Error(`Could not parse Claude's response for photo ${photoIndex + 1}. Please try uploading a clearer image.`, { cause: e })
  }
}

// ── Public API ─────────────────────────────────────────────

/**
 * Extract fabrication-table line items from one OR several image files.
 * Each photo is sent to Claude Vision separately (so the supervisor can
 * photograph different sections of a large table); the rows are merged,
 * de-duplicated by sr_no, validated against the steel-plate formula, and
 * returned sorted by sr_no — ready for the editable grid.
 *
 * @param {File|File[]} files       One image, or an array of up to 3
 * @param {string}      apiKey      Anthropic API key
 * @param {Function}    onProgress  Optional — called with status strings
 * @returns {Promise<Array>}        Normalised, validated line items
 */
export async function extractTableFromImage(files, apiKey, onProgress) {
  const fileArray = Array.isArray(files) ? files : [files]
  if (fileArray.length === 0) throw new Error('No photos provided.')
  if (fileArray.length > 3) throw new Error('You can upload at most 3 photos at once.')

  // One Claude Vision call per photo, sequentially.
  const allRawRows = []
  for (let i = 0; i < fileArray.length; i++) {
    const rows = await extractRowsFromOnePhoto(fileArray[i], apiKey, i, fileArray.length, onProgress)
    if (fileArray.length > 1) onProgress?.(`Photo ${i + 1}: ${rows.length} row${rows.length === 1 ? '' : 's'} found`)
    allRawRows.push(...rows)
  }

  onProgress?.('Merging and de-duplicating…')

  // Normalise + description-parse, and carry the table's stated total through
  // (normalizeItem drops total_weight_kg) so the formula check below can use it.
  const normalized = allRawRows.map((raw, i) => {
    const item = applyDescriptionParsing(normalizeItem(raw, i))
    item.total_weight_kg =
      raw.total_weight_kg != null && raw.total_weight_kg !== '' ? Number(raw.total_weight_kg) : null
    return item
  })

  const deduped = deduplicateRows(normalized)

  onProgress?.('Validating weights…')
  let flagged = 0
  const validated = deduped.map((row) => {
    // OR the formula check with any flag description-parsing already set
    // (e.g. a plate whose thickness couldn't be read).
    const needs = needsFormulaReview(row) || row.needs_review === true
    if (needs) flagged++
    return { ...row, needs_review: needs }
  })

  // Sort by sr_no numerically, sub-items after their parent (9, 9/1, 9/2, 10…).
  validated.sort((a, b) => {
    const parse = (k) => {
      const [p, s] = String(k).split('/')
      return [parseFloat(p) || 0, parseFloat(s) || 0]
    }
    const [a1, a2] = parse(a.sr_no)
    const [b1, b2] = parse(b.sr_no)
    return a1 !== b1 ? a1 - b1 : a2 - b2
  })

  onProgress?.(
    `✅ Done — ${validated.length} row${validated.length === 1 ? '' : 's'} extracted` +
    (flagged > 0 ? ` · ⚠️ ${flagged} flagged for review` : ' · weights verified')
  )

  return validated
}
