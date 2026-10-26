import { createFileRoute } from '@tanstack/react-router'
import { useSalePriceStore } from '@/lib/sale-price-store'
import { formatAddress, propertyKey } from '@/lib/format'
import { AutocompleteInput } from '@/components/AutocompleteInput'
import { PropertyCard } from '@/components/PropertyCard'
import { SaleHistoryCard } from '@/components/SaleHistoryCard'

export const Route = createFileRoute('/_app/sale-prices')({
  component: SalePricesPage,
  head: () => ({
    meta: [{ title: 'Sale Price History - NSW RealVision' }],
  }),
})

function SalePricesPage() {
  const {
    selectedLocality,
    selectedStreet,
    selectedPropertyKey,
    properties,
    saleHistory,
    isLoadingProperties,
    isLoadingHistory,
    selectLocality,
    clearLocality,
    selectStreet,
    clearStreet,
    selectProperty,
    searchLocalities,
    searchStreets,
  } = useSalePriceStore()

  const selectedProperty = selectedPropertyKey
    ? (properties.find((p) => propertyKey(p) === selectedPropertyKey) ?? null)
    : null

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Sale Price History</h1>
      <p className="mt-2 text-muted-foreground">
        Search for a property address to see its complete sale history.
      </p>

      {/* Search section */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <AutocompleteInput
          label="Suburb"
          placeholder="Type a suburb name..."
          value={selectedLocality}
          onSelect={selectLocality}
          onClear={clearLocality}
          search={searchLocalities}
          renderItem={(item) => (
            <div className="flex items-center justify-between">
              <span className="font-medium">{item.locality}</span>
              <span className="text-muted-foreground">{item.postCode}</span>
            </div>
          )}
          getItemLabel={(item) => `${item.locality} ${item.postCode}`}
        />

        <AutocompleteInput
          label="Street"
          placeholder={
            selectedLocality ? 'Type a street name...' : 'Select a suburb first'
          }
          disabled={!selectedLocality}
          value={selectedStreet}
          onSelect={selectStreet}
          onClear={clearStreet}
          search={searchStreets}
          renderItem={(item) => (
            <div className="flex items-center justify-between">
              <span className="font-medium">{item.streetName}</span>
              <span className="text-muted-foreground">
                {item.propertyCount} properties
              </span>
            </div>
          )}
          getItemLabel={(item) => item.streetName}
        />
      </div>

      {/* Property results */}
      {selectedStreet && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold">
            Properties on {selectedStreet.streetName},{' '}
            {selectedLocality!.locality}
          </h2>
          {isLoadingProperties ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Loading properties...
            </p>
          ) : properties.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No properties found.
            </p>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {properties.map((p) => (
                <PropertyCard
                  key={propertyKey(p)}
                  property={p}
                  isSelected={propertyKey(p) === selectedPropertyKey}
                  onSelect={selectProperty}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sale history */}
      {selectedProperty && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold">
            Sale History — {formatAddress(selectedProperty)}
            {selectedProperty.locality && `, ${selectedProperty.locality}`}
          </h2>
          {isLoadingHistory ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Loading sale history...
            </p>
          ) : saleHistory.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No sales found.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {saleHistory.map((sale, i) => (
                <SaleHistoryCard
                  key={sale.dealingNumber}
                  sale={sale}
                  previousSale={saleHistory[i + 1] ?? null}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
