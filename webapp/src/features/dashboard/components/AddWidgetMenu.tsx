/**
 * Dropdown menu for adding a widget to the active dashboard.
 * Lists all registered widget types from the registry.
 */

import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon } from '@hugeicons/core-free-icons'
import { getAllWidgetTypes } from '../widgets/registry'
import { useWidgetStore } from '../stores/widget-store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

interface Props {
  dashboardId: string
}

export function AddWidgetMenu({ dashboardId }: Props) {
  const addWidget = useWidgetStore((s) => s.addWidget)
  const widgetTypes = getAllWidgetTypes()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <HugeiconsIcon icon={Add01Icon} className="h-4 w-4" strokeWidth={2} />
          Add Widget
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {widgetTypes.map((def) => {
          const Icon = def.icon
          return (
            <DropdownMenuItem
              key={def.type}
              onClick={() => addWidget(dashboardId, def.type)}
            >
              <Icon className="h-4 w-4" />
              {def.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
