import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAreaActions } from '@/features/areas/hooks/use-areas'
import { AreaEditor } from '@/features/areas/components/AreaEditor'

export const Route = createFileRoute('/_app/areas/new')({
  component: CreateAreaPage,
  head: () => ({
    meta: [{ title: 'Create Area - NSW RealVision' }],
  }),
})

function CreateAreaPage() {
  const navigate = useNavigate()
  const { create } = useAreaActions()

  return (
    <AreaEditor
      onSave={(data) => {
        create({
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
