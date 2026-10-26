import type { ExpressionSpecification } from 'maplibre-gl'
import type { ColorMode } from './types'

export function getCircleColor(colorMode: ColorMode): ExpressionSpecification {
  switch (colorMode) {
    case 'price':
      return [
        'interpolate',
        ['linear'],
        ['get', 'purchasePrice'],
        200_000,
        'hsl(240, 70%, 60%)',
        500_000,
        'hsl(180, 70%, 50%)',
        1_000_000,
        'hsl(120, 60%, 45%)',
        2_000_000,
        'hsl(40, 80%, 50%)',
        5_000_000,
        'hsl(0, 80%, 50%)',
      ]
    case 'zone':
      return [
        'match',
        ['slice', ['coalesce', ['get', 'zoneCode'], 'X'], 0, 1],
        'R',
        'hsl(140, 60%, 45%)',
        'B',
        'hsl(220, 70%, 55%)',
        'I',
        'hsl(25, 80%, 50%)',
        'E',
        'hsl(160, 50%, 40%)',
        'S',
        'hsl(280, 50%, 55%)',
        'W',
        'hsl(200, 60%, 50%)',
        /* fallback */ 'hsl(0, 0%, 60%)',
      ]
    case 'recency':
      return [
        'interpolate',
        ['linear'],
        ['get', 'contractYear'],
        1990,
        'hsl(0, 0%, 70%)',
        2026,
        'hsl(210, 80%, 55%)',
      ]
    case 'confidence':
      return [
        'match',
        ['coalesce', ['get', 'geocodeConfidence'], 'unknown'],
        'high',
        'hsl(140, 65%, 45%)',
        'medium',
        'hsl(45, 80%, 50%)',
        'low',
        'hsl(0, 70%, 50%)',
        /* fallback */ 'hsl(0, 0%, 55%)',
      ]
  }
}

export function getClusterColor(): string {
  return 'hsl(220, 60%, 50%)'
}
