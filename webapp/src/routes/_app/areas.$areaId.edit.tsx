import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useArea, useAreaActions } from '@/features/areas/hooks/use-areas'
import { AreaEditor } from '@/features/areas/components/AreaEditor'

export const Route = createFileRoute('/_app/areas/$areaId/edit')({
  component: EditAreaPage,
  head: () => ({
    meta: [{ title: 'Edit Area - NSW RealVision' }],
  }),
})

function EditAreaPage() {
  const { areaId } = Route.useParams()
  const navigate = useNavigate()
  const area = useArea(areaId)
  const { update } = useAreaActions()

  // Area not found — redirect to list
  if (!area) {
    navigate({ to: '/areas' })
    return null
  }

  return (
    <AreaEditor
      initialArea={area}
      onSave={(data) => {
        update(areaId, {
          name: data.name,
          description: data.description,
          polygon: data.polygon,
          color: data.color,
        })
        navigate({ to: '/areas' })
      }}
      onCancel={() => navigate({ to: '/areas' })}
    />
  )
}
