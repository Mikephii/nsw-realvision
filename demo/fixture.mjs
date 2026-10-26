// The demo board: one full-size Growth Heatmap, written into the app's localStorage keys
// (zustand persist format) before the page loads.
export const DASHBOARD_ID = 'demo-board'
export const WIDGET_ID = 'demo-heatmap'

export function demoStorage({ viewport, rows = 10 } = {}) {
  const now = Date.UTC(2026, 9, 26)
  return {
    'rv-theme': 'light',
    'rv-dashboards': JSON.stringify({
      state: {
        dashboards: [
          {
            id: DASHBOARD_ID,
            name: 'Sydney growth',
            createdAt: now,
            updatedAt: now,
          },
        ],
        activeDashboardId: DASHBOARD_ID,
      },
      version: 0,
    }),
    'rv-widgets': JSON.stringify({
      state: {
        widgets: {
          [WIDGET_ID]: {
            id: WIDGET_ID,
            dashboardId: DASHBOARD_ID,
            type: 'growth-heatmap',
            config: {
              yearsBack: 10,
              loessYearsBack: 10,
              metric: 'median-price',
              growthMethod: 'loess',
              strataFilter: 'all',
              renderer: 'custom',
              showH3Borders: true,
              viewport: viewport ?? {
                longitude: 150.9,
                latitude: -33.4,
                zoom: 6.3,
              },
            },
            layout: {
              i: WIDGET_ID,
              x: 0,
              y: 0,
              w: 12,
              h: rows,
              minW: 4,
              minH: 3,
            },
          },
        },
      },
      version: 0,
    }),
  }
}
