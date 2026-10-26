# The NSW Valuer General `.DAT` format

The bulk sales files are flat ASCII, semicolon-delimited, with a trailing `;` on every line. Each file
holds several record types. The authoritative schemas are the Valuer General's PDFs in
[reference/](reference/README.md); this page summarises what the parser in `scripts/src/parser/`
relies on.

## Record types

| Record | What |
|---|---|
| **A** | Header: file type (`RTSALEDATA`), district code, download timestamp |
| **B** | Sale: property address, contract and settlement dates, purchase price, zoning, area, nature of property, dealing number |
| **C** | Legal description: lot and plan. A property can have several C records of up to 70 characters each, joined without spaces in the order they appear |
| **D** | Owner: a purchaser or vendor flag only (personal details are removed from the published files) |
| **Z** | Trailer: record counts, used to validate the file |

## Two eras

| Era | Files | Records |
|---|---|---|
| **2001 to now** | Weekly files, one per district per week, and yearly files | A, B, C, D, Z with the full field set |
| **1990 to 2001** (archived) | Yearly files | A, B, Z only. The B record has a different layout: valuation number, unit, house and street, suburb, postcode, contract date, price, a land description of up to 1000 characters, area, dimensions, component and zone codes, and vendor and purchaser name fields. The ETL never stores the names |

The parser detects the era from the file (`format-detector.ts`) and uses a separate parse path for
each (`file-parser.ts`, `archived-file-parser.ts`).

## File names

Current format: `{district}_SALES_DATA_NNME_{DDMMYYYY}.DAT`, for example
`001_SALES_DATA_NNME_20012025.DAT`.

- The first three characters are the district code, which maps to a council (LGA). See the district
  codes PDF.
- The date is when the file was created. A weekly file holds sales registered in the week before it.

Archived format: `ARCHIVE_SALES_{YYYY}.DAT`.

## Field notes

- Empty fields are `;;`.
- Contract and settlement dates are `CCYYMMDD`. The download timestamp in record A is
  `CCYYMMDD HH24:MI`.
- Area looks like `7777777.333`. Area type `M` means square metres and `H` means hectares.
- Nature of property: `V` vacant, `R` residence, `3` other.
- Purchase price is a plain number.
- Percent interest of sale is empty when the sale is for 100%.
- **District codes change** between years when councils merge, so the same suburb can appear under
  different codes.
- **Strata**: a sale is a strata-titled property (a unit or apartment) when its strata field is set,
  and freehold (a house or land) otherwise. Every analytical widget can filter on this.
- **Zone codes** use two systems: single-letter codes before 2011 (`A` residential, `B` business,
  `I` industrial, `R` non-urban and so on) and the LEP codes after (`R1`-`R5`, `B1`-`B7`,
  `IN1`-`IN4`, `SP1`-`SP3`, `RE1`-`RE2`, `E1`-`E4`, `RU1`-`RU6`, `W1`-`W3`). `dim_zone` maps both.

## Key terms

| Term | Meaning |
|---|---|
| District | A local government area (council), identified by a three-digit code |
| Property id | A unique number for every property in NSW |
| Dealing number | A unique id for a sale transaction |
| Sale counter | Makes a record unique within a file (a property can sell more than once) |
| Locality | The suburb name, as recorded in the Register of Land Values |
