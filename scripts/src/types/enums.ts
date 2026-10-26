/** Nature of property codes from B record */
export type NatureOfProperty = 'V' | 'R' | '3'

/** Area measurement type codes */
export type AreaType = 'M' | 'H'

/** Purchaser/Vendor indicator on D record */
export type PurchaserVendor = 'P' | 'V'

/** Descriptions for nature of property codes */
export const NATURE_OF_PROPERTY_LABELS: Record<NatureOfProperty, string> = {
  V: 'Vacant',
  R: 'Residence',
  '3': 'Other',
}

/** Descriptions for area type codes */
export const AREA_TYPE_LABELS: Record<AreaType, string> = {
  M: 'Square Metres',
  H: 'Hectares',
}
