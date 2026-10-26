/**
 * Storage adapter interface for dashboard persistence.
 * Currently backed by localStorage, can be swapped to server-side storage later.
 */

export interface StorageAdapter {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export const localStorageAdapter: StorageAdapter = {
  getItem: (key) => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(key)
  },
  setItem: (key, value) => {
    if (typeof window === 'undefined') return
    localStorage.setItem(key, value)
  },
  removeItem: (key) => {
    if (typeof window === 'undefined') return
    localStorage.removeItem(key)
  },
}
