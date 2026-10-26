import { createFileRoute, useLoaderData } from '@tanstack/react-router'
import { getDatabaseStats } from '@/lib/server-fns'

export const Route = createFileRoute('/_app/dashboard')({
  loader: async () => {
    const stats = await getDatabaseStats()
    return { stats }
  },
  component: DashboardPage,
})

function formatNumber(n: number): string {
  return n.toLocaleString('en-AU')
}

function DashboardPage() {
  const { stats } = useLoaderData({ from: '/_app/dashboard' })

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        NSW property sales analytics powered by DuckDB.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-6">
          <p className="text-sm font-medium text-muted-foreground">
            Total Sales
          </p>
          <p className="mt-1 text-2xl font-bold">
            {formatNumber(stats.totalSales)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <p className="text-sm font-medium text-muted-foreground">Suburbs</p>
          <p className="mt-1 text-2xl font-bold">
            {formatNumber(stats.totalSuburbs)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <p className="text-sm font-medium text-muted-foreground">
            Year Range
          </p>
          <p className="mt-1 text-2xl font-bold">
            {stats.yearRange[0]}–{stats.yearRange[1]}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <p className="text-sm font-medium text-muted-foreground">Districts</p>
          <p className="mt-1 text-2xl font-bold">
            {formatNumber(stats.totalDistricts)}
          </p>
        </div>
      </div>

      <h2 className="mt-10 text-xl font-semibold tracking-tight">Features</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-6">
          <h3 className="font-semibold">Suburb Comparison</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Compare price trends across multiple suburbs.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h3 className="font-semibold">Growth Rates</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Analyse year-over-year price growth by area.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h3 className="font-semibold">Market Overview</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Aggregate statistics across regions and zones.
          </p>
        </div>
      </div>
    </>
  )
}
