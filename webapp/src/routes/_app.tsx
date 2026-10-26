import { Outlet, createFileRoute, useLoaderData } from '@tanstack/react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/components/ThemeProvider'
import { AppSidebar } from '@/components/AppSidebar'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { DataCoverageProvider } from '@/lib/data-coverage'
import { getDataCoverage } from '@/lib/server-fns'

export const Route = createFileRoute('/_app')({
  loader: async () => ({ coverage: await getDataCoverage() }),
  component: AppLayout,
})

function AppLayout() {
  const { coverage } = useLoaderData({ from: '/_app' })
  return (
    <DataCoverageProvider coverage={coverage}>
      <ThemeProvider>
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
                <SidebarTrigger className="-ml-1" />
              </header>
              <div className="flex-1 overflow-auto p-4 md:p-6 bg-background surface-pattern">
                <Outlet />
              </div>
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
      </ThemeProvider>
    </DataCoverageProvider>
  )
}
