import { Link, useMatchRoute } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  DashboardSquare01Icon,
  LayoutGridIcon,
  MapsSquare01Icon,
  Moon02Icon,
  SearchList01Icon,
  Sun02Icon,
} from '@hugeicons/core-free-icons'
import { Logo } from '@/components/Logo'
import { useTheme } from '@/components/ThemeProvider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { useAreas } from '@/features/areas/hooks/use-areas'
import { useDataCoverage } from '@/lib/data-coverage'
import { formatDate } from '@/lib/format'

const navItems = [
  {
    to: '/dashboard' as const,
    label: 'Dashboard',
    icon: DashboardSquare01Icon,
  },
  { to: '/boards' as const, label: 'Boards', icon: LayoutGridIcon },
  { to: '/sale-prices' as const, label: 'Sale Prices', icon: SearchList01Icon },
  { to: '/areas' as const, label: 'Custom Areas', icon: MapsSquare01Icon },
]

export function AppSidebar() {
  const matchRoute = useMatchRoute()
  const { theme, toggleTheme } = useTheme()
  const areas = useAreas()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link to="/" className="flex items-center gap-2 px-2 py-1">
          <Logo className="h-6 w-6 shrink-0" />
          <span className="text-sm font-bold tracking-tight group-data-[collapsible=icon]:hidden">
            NSW RealVision
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Analytics</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    isActive={!!matchRoute({ to: item.to })}
                    tooltip={item.label}
                  >
                    <Link to={item.to}>
                      <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.to === '/areas' && areas.length > 0 && (
                    <SidebarMenuBadge>{areas.length}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={toggleTheme}
              tooltip={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              <HugeiconsIcon
                icon={theme === 'dark' ? Sun02Icon : Moon02Icon}
                strokeWidth={2}
              />
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <DataAttribution />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/** Data cut-off and the attribution the NSW VG and G-NAF licences ask for. */
function DataAttribution() {
  const coverage = useDataCoverage()
  return (
    <div className="px-2 pb-1 text-[10px] leading-snug text-muted-foreground group-data-[collapsible=icon]:hidden">
      {coverage?.dataTo && (
        <p className="font-medium">Sales data to {formatDate(coverage.dataTo)}</p>
      )}
      <p className="mt-1">
        Sales data ©{' '}
        <a
          href="https://www.valuergeneral.nsw.gov.au/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:no-underline"
        >
          Valuer General NSW
        </a>
        , CC BY 3.0 AU. Addresses: G-NAF © Geoscape Australia.
      </p>
    </div>
  )
}
