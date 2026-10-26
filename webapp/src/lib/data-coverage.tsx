/**
 * Data coverage context: what the loaded database covers (latest heatmap year, newest
 * weekly file). Loaded once by the `/_app` route and read by widgets with
 * {@link useDataCoverage}, so periods end where the data does rather than at today's date.
 */

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { DataCoverage } from './heatmap-queries'

const DataCoverageContext = createContext<DataCoverage | null>(null)

export function DataCoverageProvider({
  coverage,
  children,
}: {
  coverage: DataCoverage | null
  children: ReactNode
}) {
  return (
    <DataCoverageContext.Provider value={coverage}>
      {children}
    </DataCoverageContext.Provider>
  )
}

/** The loaded database's coverage, or null outside the app layout or before it loads. */
export function useDataCoverage(): DataCoverage | null {
  return useContext(DataCoverageContext)
}
