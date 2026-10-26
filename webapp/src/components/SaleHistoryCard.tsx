import type { PropertySale } from '@/lib/property-history'
import { formatDate, formatPrice, natureLabel } from '@/lib/format'
import { annualizedGrowth, percentChange } from '@/lib/stats'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface SaleHistoryCardProps {
  sale: PropertySale
  previousSale: PropertySale | null
}

export function SaleHistoryCard({ sale, previousSale }: SaleHistoryCardProps) {
  const totalChange = previousSale
    ? percentChange(previousSale.purchasePrice, sale.purchasePrice)
    : null
  const annualized = previousSale
    ? annualizedGrowth(
        previousSale.purchasePrice,
        sale.purchasePrice,
        previousSale.contractDate,
        sale.contractDate,
      )
    : null

  return (
    <div>
      {totalChange !== null && (
        <div className="flex items-center justify-center gap-2 py-1">
          <Badge variant={totalChange >= 0 ? 'default' : 'destructive'}>
            {totalChange >= 0 ? '+' : ''}
            {totalChange.toFixed(1)}%
          </Badge>
          {annualized !== null && (
            <Badge variant="outline">
              {annualized >= 0 ? '+' : ''}
              {annualized.toFixed(1)}% p.a.
            </Badge>
          )}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            {formatPrice(sale.purchasePrice)}
          </CardTitle>
          <CardDescription>
            {formatDate(sale.contractDate)}
            {sale.settlementDate &&
              ` · Settled ${formatDate(sale.settlementDate)}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-1.5 text-sm">
            {sale.natureOfProperty && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Type</span>
                <span>{natureLabel(sale.natureOfProperty)}</span>
              </div>
            )}
            {sale.zoneCode && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Zone</span>
                <span>{sale.zoneCode}</span>
              </div>
            )}
            {sale.area != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Area</span>
                <span>
                  {sale.area.toLocaleString('en-AU')}{' '}
                  {sale.areaType === 'H' ? 'ha' : 'sqm'}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
