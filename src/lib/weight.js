// ============================================================
// Steel weight calculation core
//
// All dimensions are entered in millimetres and converted to
// metres (÷1000) before applying the volumetric formula with the
// density of steel (7850 kg/m³). Every formula yields the weight
// of ONE piece (kg); the row total = unit weight × quantity.
// ============================================================

export const STEEL_DENSITY = 7850 // kg/m³

/**
 * Material types and the dimension fields each one needs.
 * `dims` drives both the editable table and the extraction mapping.
 */
export const MATERIAL_TYPES = [
  { value: 'plate',      label: 'Plate/Sheet',   dims: ['length_mm', 'width_mm', 'thickness_mm'] },
  { value: 'pipe',       label: 'Pipe',          dims: ['length_mm', 'outer_diameter_mm', 'inner_diameter_mm'] },
  { value: 'solid_rod',  label: 'Solid Rod/Bar', dims: ['length_mm', 'diameter_mm'] },
  { value: 'flat_bar',   label: 'Flat Bar',      dims: ['length_mm', 'width_mm', 'thickness_mm'] },
  { value: 'angle_iron', label: 'Angle Iron',    dims: ['length_mm', 'side_a_mm', 'side_b_mm', 'thickness_mm'] },
  { value: 'other',      label: 'Other',         dims: ['length_mm', 'width_mm', 'thickness_mm'], manualUnitWeight: true },
]

const MATERIAL_VALUES = new Set(MATERIAL_TYPES.map((m) => m.value))

export function materialLabel(value) {
  return MATERIAL_TYPES.find((m) => m.value === value)?.label ?? 'Other'
}

export function materialDims(value) {
  return MATERIAL_TYPES.find((m) => m.value === value)?.dims ?? ['length_mm', 'width_mm', 'thickness_mm']
}

export function normalizeMaterial(value) {
  return MATERIAL_VALUES.has(value) ? value : 'other'
}

/** Short labels for each dimension field. */
export const DIM_LABELS = {
  length_mm:         'Length',
  width_mm:          'Width',
  thickness_mm:      'Thickness',
  outer_diameter_mm: 'OD',
  inner_diameter_mm: 'ID',
  diameter_mm:       'Diameter',
  side_a_mm:         'Side A',
  side_b_mm:         'Side B',
}

const m = (v) => (Number(v) || 0) / 1000 // mm → m

/**
 * Weight of one piece (kg) computed from dimensions, or `null`
 * when the required dimensions for that material type are missing.
 * 'other' always returns null (its unit weight is entered manually).
 */
export function computeUnitWeight(item) {
  const L = m(item.length_mm)
  const D = STEEL_DENSITY

  switch (item.material_type) {
    case 'plate':
    case 'flat_bar': {
      const W = m(item.width_mm)
      const T = m(item.thickness_mm)
      if (!L || !W || !T) return null
      return L * W * T * D
    }
    case 'pipe': {
      const OD = m(item.outer_diameter_mm)
      const ID = m(item.inner_diameter_mm) // inner may legitimately be 0 (solid-ish)
      if (!L || !OD || ID >= OD) return null
      return (Math.PI / 4) * (OD * OD - ID * ID) * L * D
    }
    case 'solid_rod': {
      const dia = m(item.diameter_mm)
      if (!L || !dia) return null
      return (Math.PI / 4) * dia * dia * L * D
    }
    case 'angle_iron': {
      const A = m(item.side_a_mm)
      const B = m(item.side_b_mm)
      const T = m(item.thickness_mm)
      if (!L || !A || !B || !T) return null
      return (A + B - T) * T * L * D
    }
    case 'other':
    default:
      return null
  }
}

/** True when the unit weight is derived from dimensions (read-only in the UI). */
export function isComputed(item) {
  return item.material_type !== 'other' && computeUnitWeight(item) != null
}

/**
 * The unit weight actually used for totals: computed when possible,
 * otherwise the manually-entered / extracted `unit_weight` fallback.
 */
export function effectiveUnitWeight(item) {
  if (item.material_type === 'other') return Number(item.unit_weight) || 0
  const computed = computeUnitWeight(item)
  if (computed != null) return computed
  return Number(item.unit_weight) || 0
}

export function rowTotal(item) {
  return effectiveUnitWeight(item) * (Number(item.quantity) || 0)
}

export function grandTotalKg(items) {
  return (items || []).reduce((sum, it) => sum + rowTotal(it), 0)
}

/** A fresh blank line item. */
export function blankItem(srNo = '') {
  return {
    sr_no:             srNo === '' ? '' : String(srNo),
    section:           '',
    needs_review:      false,
    description:       '',
    material_type:     'plate',
    length_mm:         null,
    width_mm:          null,
    thickness_mm:      null,
    outer_diameter_mm: null,
    inner_diameter_mm: null,
    diameter_mm:       null,
    side_a_mm:         null,
    side_b_mm:         null,
    unit_weight:       null,
    quantity:          1,
    remarks:           '',
  }
}

/** Coerce one raw extracted/loaded object into a complete, typed item. */
export function normalizeItem(raw = {}, index = 0) {
  const numeric = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
  return {
    sr_no:             raw.sr_no != null && raw.sr_no !== '' ? String(raw.sr_no) : String(index + 1),
    section:           raw.section ?? '',
    needs_review:      raw.needs_review ?? false,
    description:       raw.description ?? '',
    material_type:     normalizeMaterial(raw.material_type),
    length_mm:         numeric(raw.length_mm),
    width_mm:          numeric(raw.width_mm),
    thickness_mm:      numeric(raw.thickness_mm),
    outer_diameter_mm: numeric(raw.outer_diameter_mm),
    inner_diameter_mm: numeric(raw.inner_diameter_mm),
    diameter_mm:       numeric(raw.diameter_mm),
    side_a_mm:         numeric(raw.side_a_mm),
    side_b_mm:         numeric(raw.side_b_mm),
    unit_weight:       numeric(raw.unit_weight),
    quantity:          raw.quantity != null && raw.quantity !== '' ? Number(raw.quantity) : 1,
    remarks:           raw.remarks ?? '',
  }
}

export function fmtKg(n) {
  return (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtTonnes(kg) {
  return ((Number(kg) || 0) / 1000).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}
