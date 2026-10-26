import { createFileRoute } from '@tanstack/react-router'
import { useDashboardStore } from '@/features/dashboard/stores/dashboard-store'
import { DashboardTabs } from '@/features/dashboard/components/DashboardTabs'
import { DashboardGrid } from '@/features/dashboard/components/DashboardGrid'
import { AddWidgetMenu } from '@/features/dashboard/components/AddWidgetMenu'

// Ensure all widget types are registered
import '@/features/dashboard/widgets'

export const Route = createFileRoute('/_app/boards')({
  component: BoardsPage,
  head: () => ({
    meta: [{ title: 'Boards - NSW RealVision' }],
  }),
})

function BoardsPage() {
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId)
  const dashboards = useDashboardStore((s) => s.dashboards)
  const createDashboard = useDashboardStore((s) => s.createDashboard)

  // Auto-create first board if none exist
  if (dashboards.length === 0) {
    return (
      <>
        <h1 className="text-3xl font-bold tracking-tight">Boards</h1>
        <p className="mt-2 text-muted-foreground">
          Create interactive dashboards with charts and visualisations.
        </p>
        <div className="mt-8 flex flex-col items-center gap-4 rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No boards yet. Create your first one to get started.
          </p>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={() => createDashboard('My Board')}
          >
            Create Board
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Boards</h1>
        {activeDashboardId && <AddWidgetMenu dashboardId={activeDashboardId} />}
      </div>

      <div className="mt-4">
        <DashboardTabs />
      </div>

      {activeDashboardId && (
        <div className="mt-4">
          <DashboardGrid dashboardId={activeDashboardId} />
        </div>
      )}
    </>
  )
}
