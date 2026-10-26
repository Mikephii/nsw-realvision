import { Link, createFileRoute } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, MapsSquare01Icon } from '@hugeicons/core-free-icons'
import { useAreas } from '@/features/areas/hooks/use-areas'
import { AreaListCard } from '@/features/areas/components/AreaListCard'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/_app/areas/')({
  component: AreasPage,
  head: () => ({
    meta: [{ title: 'Custom Areas - NSW RealVision' }],
  }),
})

function AreasPage() {
  const areas = useAreas()

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Custom Areas</h1>
          <p className="mt-2 text-muted-foreground">
            Draw geographic areas to use as filters in charts and maps.
          </p>
        </div>
        <Button asChild>
          <Link to="/areas/new">
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Create Area
          </Link>
        </Button>
      </div>

      {areas.length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-4 rounded-lg border border-dashed p-16 text-center">
          <div className="rounded-full bg-muted p-3">
            <HugeiconsIcon
              icon={MapsSquare01Icon}
              className="size-8 text-muted-foreground"
              strokeWidth={1.5}
            />
          </div>
          <div className="max-w-sm space-y-1.5">
            <p className="text-sm font-medium">No custom areas yet</p>
            <p className="text-sm text-muted-foreground">
              Custom areas let you draw boundaries on a map and use them as
              geographic filters across your charts and dashboards. Define
              neighbourhoods, investment zones, or any region you want to track.
            </p>
          </div>
          <Button asChild>
            <Link to="/areas/new">
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
              Create Your First Area
            </Link>
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map((area) => (
            <AreaListCard key={area.id} area={area} />
          ))}
        </div>
      )}
    </>
  )
}
