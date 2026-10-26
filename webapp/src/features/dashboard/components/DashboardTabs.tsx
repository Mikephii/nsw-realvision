/**
 * Tab bar for switching between saved dashboards.
 * Includes create, rename, and delete actions.
 */

import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  Cancel01Icon,
  Delete02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { useDashboardStore } from '../stores/dashboard-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function DashboardTabs() {
  const dashboards = useDashboardStore((s) => s.dashboards)
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId)
  const createDashboard = useDashboardStore((s) => s.createDashboard)
  const deleteDashboard = useDashboardStore((s) => s.deleteDashboard)
  const renameDashboard = useDashboardStore((s) => s.renameDashboard)
  const setActiveDashboard = useDashboardStore((s) => s.setActiveDashboard)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const startRename = (id: string, currentName: string) => {
    setEditingId(id)
    setEditName(currentName)
  }

  const confirmRename = () => {
    if (editingId && editName.trim()) {
      renameDashboard(editingId, editName.trim())
    }
    setEditingId(null)
  }

  const handleCreate = () => {
    const count = dashboards.length + 1
    createDashboard(`Board ${count}`)
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {dashboards.map((d) => (
        <div
          key={d.id}
          className={cn(
            'group flex items-center gap-1 rounded-md border px-2 py-1 text-sm transition-colors',
            d.id === activeDashboardId
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
          )}
        >
          {editingId === d.id ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                confirmRename()
              }}
              className="flex items-center gap-1"
            >
              <Input
                autoFocus
                className="h-5 w-24 px-1 text-xs"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={confirmRename}
              />
              <button
                type="submit"
                className="text-muted-foreground hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={Tick02Icon}
                  className="h-3 w-3"
                  strokeWidth={2}
                />
              </button>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  className="h-3 w-3"
                  strokeWidth={2}
                />
              </button>
            </form>
          ) : (
            <>
              <button
                type="button"
                className="cursor-pointer"
                onClick={() => setActiveDashboard(d.id)}
                onDoubleClick={() => startRename(d.id, d.name)}
              >
                {d.name}
              </button>
              <button
                type="button"
                className="ml-1 hidden text-muted-foreground hover:text-destructive group-hover:inline-flex"
                onClick={() => deleteDashboard(d.id)}
              >
                <HugeiconsIcon
                  icon={Delete02Icon}
                  className="h-3 w-3"
                  strokeWidth={2}
                />
              </button>
            </>
          )}
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 text-muted-foreground"
        onClick={handleCreate}
      >
        <HugeiconsIcon
          icon={Add01Icon}
          className="h-3.5 w-3.5"
          strokeWidth={2}
        />
        New Board
      </Button>
    </div>
  )
}
