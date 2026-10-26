/**
 * Zustand store for the Sale Price History page.
 * Manages search state, selections, and data fetching.
 */

import { create } from 'zustand'
import { propertyKey } from './format'
import {
  getLocalities,
  getProperties,
  getPropertySaleHistory,
  getStreets,
} from './server-fns'
import type {
  LocalitySuggestion,
  PropertyResult,
  StreetSuggestion,
} from './autocomplete'
import type { PropertySale } from './property-history'

interface SalePriceState {
  // Selections
  selectedLocality: LocalitySuggestion | null
  selectedStreet: StreetSuggestion | null
  selectedPropertyKey: string | null

  // Data
  properties: Array<PropertyResult>
  saleHistory: Array<PropertySale>

  // Loading
  isLoadingProperties: boolean
  isLoadingHistory: boolean

  // Actions
  selectLocality: (item: LocalitySuggestion) => void
  clearLocality: () => void
  selectStreet: (item: StreetSuggestion) => void
  clearStreet: () => void
  selectProperty: (property: PropertyResult) => void

  // Search helpers (for autocomplete)
  searchLocalities: (prefix: string) => Promise<Array<LocalitySuggestion>>
  searchStreets: (prefix: string) => Promise<Array<StreetSuggestion>>
}

export const useSalePriceStore = create<SalePriceState>((set, get) => ({
  selectedLocality: null,
  selectedStreet: null,
  selectedPropertyKey: null,
  properties: [],
  saleHistory: [],
  isLoadingProperties: false,
  isLoadingHistory: false,

  selectLocality: (item) => {
    set({
      selectedLocality: item,
      selectedStreet: null,
      selectedPropertyKey: null,
      properties: [],
      saleHistory: [],
    })
  },

  clearLocality: () => {
    set({
      selectedLocality: null,
      selectedStreet: null,
      selectedPropertyKey: null,
      properties: [],
      saleHistory: [],
    })
  },

  selectStreet: (item) => {
    const { selectedLocality } = get()
    if (!selectedLocality) return

    set({
      selectedStreet: item,
      selectedPropertyKey: null,
      saleHistory: [],
      isLoadingProperties: true,
    })

    getProperties({
      data: {
        locality: selectedLocality.locality,
        streetName: item.streetName,
      },
    })
      .then((properties) => set({ properties }))
      .catch((err) => {
        console.error('Failed to load properties:', err)
        set({ properties: [] })
      })
      .finally(() => set({ isLoadingProperties: false }))
  },

  clearStreet: () => {
    set({
      selectedStreet: null,
      selectedPropertyKey: null,
      properties: [],
      saleHistory: [],
    })
  },

  selectProperty: (property) => {
    const key = propertyKey(property)
    set({ selectedPropertyKey: key, isLoadingHistory: true })

    getPropertySaleHistory({
      data: {
        propertyId: property.propertyId,
        unitNumber: property.unitNumber,
      },
    })
      .then((saleHistory) => set({ saleHistory }))
      .catch((err) => {
        console.error('Failed to load sale history:', err)
        set({ saleHistory: [] })
      })
      .finally(() => set({ isLoadingHistory: false }))
  },

  searchLocalities: (prefix) => getLocalities({ data: { prefix } }),

  searchStreets: (prefix) => {
    const { selectedLocality } = get()
    if (!selectedLocality) return Promise.resolve([])
    return getStreets({ data: { locality: selectedLocality.locality, prefix } })
  },
}))
