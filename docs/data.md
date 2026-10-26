# Getting the data

NSW RealVision runs on public data. Nothing comes with the repository: you download the NSW Valuer
General sales files and the G-NAF address file, and the ETL in `scripts/` builds a DuckDB database
from them at `data/realvision.duckdb`.

| What | Where it goes | Size |
|---|---|---|
| NSW Valuer General property sales files (ZIPs, then extracted `.DAT` files) | `NSWVGData/` | about 2.4 GB for 1990 to early 2026 |
| G-NAF address file (only the NSW tables are kept) | `GNAFData/` | about 2.6 GB including the download |
| The database the app reads | `data/realvision.duckdb` | about 1.5 GB |

All three folders are gitignored.

## 1. Download the NSW Valuer General sales files

The Valuer General NSW publishes bulk **Property Sales Information (PSI)**: every registered sale in
NSW. Find the bulk download page on [valuergeneral.nsw.gov.au](https://www.valuergeneral.nsw.gov.au/)
(search the site for "bulk property sales information").

There are three kinds of file:

| Kind | Covers | Notes |
|---|---|---|
| **Weekly** | Sales registered in the week before the file date, one `.DAT` per council district | Published every Monday. Use these for the current year |
| **Yearly** | A whole year, one ZIP per year | From 2001. Use these for past years |
| **Archived** | 1990 to 2001 | An older, simpler format; the ETL handles both |

For reference, the files follow these URL patterns (`YYYYMMDD` is a Monday):

```
https://www.valuergeneral.nsw.gov.au/__psi/weekly/YYYYMMDD.zip
https://www.valuergeneral.nsw.gov.au/__psi/yearly/YYYY.zip
```

**Download them in a browser.** The site blocks scripted downloads, so `curl` and similar tools get an
HTTP 403. There is no download command in the ETL for that reason.

### How much to download

- **To try it out:** the last 10 yearly files plus this year's weekly files. The heatmap's 5 and 10
  year views and the charts work. Longer lookbacks show gaps.
- **For everything:** every yearly file from 1990 and this year's weekly files. The heatmap's 20 and
  25 year views and its LOESS curves need the older years.

### Where to put them

```
NSWVGData/
└── downloadedZips/
    ├── yearly/       ← yearly and archived ZIPs, e.g. 1995.zip, 2024.zip, 2025.zip
    └── weekly/       ← weekly ZIPs, e.g. 20260105.zip, 20260112.zip
```

The ZIP file names don't matter. The extractor reads the `.DAT` names inside each ZIP to decide where
each file goes.

## 2. Extract

```sh
pnpm etl extract              # every ZIP (skips files already extracted)
pnpm etl extract --force      # re-extract everything
pnpm etl extract --yearly-only
pnpm etl extract --weekly-only
```

(`pnpm etl ...` works from the repository root; inside `scripts/` it's the same command.)

This creates the layout the loader expects:

```
NSWVGData/
├── 1990/archive/ARCHIVE_SALES_1990.DAT        ← archived format (1990 to 2001)
├── ...
├── 2025/
│   ├── 20250106/                              ← one folder per week (YYYYMMDD)
│   │   ├── 001_SALES_DATA_NNME_06012025.DAT   ← one file per district
│   │   └── ...
│   └── ...
└── 2026/
```

- **Current format** files are named `NNN_SALES_DATA_NNME_DDMMYYYY.DAT`: the first three digits are
  the district (council) code, and the date becomes the week folder.
- **Archived format** files are named `ARCHIVE_SALES_YYYY.DAT`.

The Valuer General has packaged its ZIPs differently over the years, and the extractor handles all of
them:

| Years | Packaging |
|---|---|
| 1990 to 2000 | Flat archive files |
| 2001 | Date folders plus an archive |
| 2002 to 2018 | A year folder with human-readable date folders |
| 2019 to 2020 | ZIPs inside ZIPs (extracted recursively) |
| 2021 onwards | Flat per-district `.DAT` files |

## 3. Download G-NAF

Geocoding (turning an address into a point on the map) uses
[G-NAF](https://data.gov.au/dataset/geocoded-national-address-file-g-naf), the Geocoded National
Address File. The heatmap and the property map need it.

```sh
pnpm etl geocode --download   # downloads G-NAF from data.gov.au into GNAFData/, then geocodes
```

The download is about 1.7 GB. Only the four NSW tables the matcher needs are extracted:
`NSW_ADDRESS_DETAIL`, `NSW_ADDRESS_DEFAULT_GEOCODE`, `NSW_STREET_LOCALITY` and `NSW_LOCALITY`.

G-NAF is updated every quarter. The download URL is pinned in
`scripts/src/geocode/gnaf-downloader.ts` (`GNAF_DOWNLOAD_URL`, currently the February 2026 GDA2020
release). To use a newer release, change it to the newest GDA2020 PSV ZIP listed on the data.gov.au
dataset page.

## 4. Load

```sh
pnpm etl load --full   # first time, or to rebuild everything
pnpm etl load          # later: only files not loaded yet
```

`load` runs the whole pipeline:

1. **Parse and load:** finds the `.DAT` files, parses and cleans them, and loads `fact_property_sale`.
2. **Data quality:** flags nominal transfers, duplicates and outliers.
3. **Geocoding:** matches sale addresses against G-NAF and fills `dim_address` with coordinates.
4. **Heatmap aggregation:** builds the H3 hex growth table (`agg_h3_growth`) and the precomputed
   LOESS curves (`agg_h3_loess_curve`).

| Flag | Effect |
|---|---|
| `--skip-geocode` | Skip geocoding. The heatmap and property map stay empty |
| `--skip-quality` | Skip data quality flagging |
| `--skip-heatmap` | Skip the heatmap aggregation |
| `--db <path>`, `--data <path>`, `--gnaf <path>` | Use other locations than `data/`, `NSWVGData/` and `GNAFData/` |

The full load takes a while (tens of minutes on a laptop; geocoding and the LOESS precompute are the
slow parts) and uses several GB of memory.

### Other commands

```sh
pnpm etl status              # files loaded, record count, year range
pnpm etl geocode             # re-run geocoding with the G-NAF data you have
pnpm etl geocode --status    # geocoding coverage
pnpm etl geocode --refresh   # clear all geocodes and match again (after a G-NAF update)
pnpm etl data-quality        # re-run the data quality flags
pnpm etl recompute-heatmap   # rebuild agg_h3_growth
pnpm etl recompute-loess     # rebuild agg_h3_loess_curve
pnpm etl reset               # drop every table and recreate the schema
pnpm etl parse-only <file>   # parse one .DAT file and print the result (debugging)
```

## Keeping it current

New weekly files appear every Monday. To bring a database up to date:

1. Download the new weekly ZIPs into `NSWVGData/downloadedZips/weekly/`.
2. `pnpm etl extract --weekly-only`
3. `pnpm etl load`
4. Restart the app (or swap the database file on your server; see
   [self-hosting.md](self-hosting.md#updating-the-data)).

At the start of a new year, the Valuer General publishes the previous year as a yearly file. Loading
it alongside that year's weekly files is safe: sales are keyed by district, property and dealing
number, so duplicates are replaced rather than added.

The app reads its date range from the database. The time range slider ends at the last year the
LOESS curves reach, and the sidebar shows "Sales data to" the newest weekly file loaded.

## Data quality notes

- **Nominal transfers** ($1 sales, transfers between family members), **partial-interest sales** and
  **outliers** are flagged, not deleted, and the analysis excludes them. See
  [methodology.md](methodology.md) and [research/data-cleaning-outlier-detection.md](research/data-cleaning-outlier-detection.md).
- **District codes change** when councils merge, so the same suburb can appear under different codes
  in different years. Suburb-level analysis uses the locality name.
- **Recent months are incomplete.** A sale appears in the files when it settles and is registered,
  usually weeks after the contract date, so the newest months always look thin.
- **Accuracy is not guaranteed** by the Valuer General: the data comes from several sources.

## Troubleshooting

| Problem | What to check |
|---|---|
| The heatmap is empty | Did geocoding run? `pnpm etl geocode --status`. Then `pnpm etl recompute-heatmap` and `pnpm etl recompute-loess` |
| A year is missing | `pnpm etl status`. Check its ZIP is in `downloadedZips/` and was extracted (`NSWVGData/<year>/`) |
| 2019 or 2020 files missing | Those ZIPs contain ZIPs. `pnpm etl extract --force --yearly-only` |
| The load runs out of memory | Close other apps, or lower `--batch-size` (default 100 files) |
| "database is locked" | The app (or another ETL run) has the database open. Stop it during a load |

## The file format

The `.DAT` files are semicolon-delimited text with several record types per file. See
[data-format.md](data-format.md), and the Valuer General's own PDFs in [reference/](reference/README.md).

## Licence and attribution

The sales data is © Crown in right of New South Wales through the Valuer General NSW, and published
under the [Creative Commons Attribution 3.0 Australia](https://creativecommons.org/licenses/by/3.0/au/)
licence (per the Valuer General's
[instructions document](reference/Property_Sales_Data_File_-_Instructions_V2.pdf)). G-NAF is
© Geoscape Australia, licensed by the Commonwealth of Australia under the
[Open G-NAF End User Licence Agreement](https://data.gov.au/dataset/geocoded-national-address-file-g-naf).
If you publish anything built from them, attribute both. The app does this in its footer and sidebar.
