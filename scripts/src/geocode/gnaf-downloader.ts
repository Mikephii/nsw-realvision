/**
 * Download and extract G-NAF data from data.gov.au.
 *
 * Downloads the full G-NAF ZIP (~1.7GB) and extracts only the NSW
 * PSV files needed for geocoding:
 * - Standard/NSW_ADDRESS_DETAIL_psv.psv
 * - Standard/NSW_ADDRESS_DEFAULT_GEOCODE_psv.psv
 * - Standard/NSW_STREET_LOCALITY_psv.psv
 * - Standard/NSW_LOCALITY_psv.psv
 */

import { createWriteStream } from 'node:fs'
import { mkdir, access, readdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { get } from 'node:https'
import { get as httpGet, type IncomingMessage } from 'node:http'
import yauzl from 'yauzl-promise'

/** Feb 2026 G-NAF GDA2020 download URL from data.gov.au */
const GNAF_DOWNLOAD_URL =
  'https://data.gov.au/data/dataset/19432f89-dc3a-4ef3-b943-5326ef1dbecc/resource/5be5278c-fe66-459e-845a-bea553f46b4b/download/g-naf_feb26_allstates_gda2020_psv_1022.zip'

/** The NSW PSV files we need from the G-NAF ZIP */
const NSW_FILES_NEEDED = [
  'NSW_ADDRESS_DETAIL_psv.psv',
  'NSW_ADDRESS_DEFAULT_GEOCODE_psv.psv',
  'NSW_STREET_LOCALITY_psv.psv',
  'NSW_LOCALITY_psv.psv',
]

export interface DownloadResult {
  zipPath: string
  extractedFiles: string[]
  downloadedBytes: number
}

/**
 * Check if required G-NAF NSW PSV files already exist in the target directory.
 */
export async function gnafFilesExist(gnafDir: string): Promise<boolean> {
  for (const file of NSW_FILES_NEEDED) {
    try {
      await access(join(gnafDir, file))
    } catch {
      return false
    }
  }
  return true
}

/**
 * Find existing G-NAF NSW PSV files in a directory.
 * Returns paths to the four required PSV files for the multi-table JOIN.
 */
export async function findGnafFiles(gnafDir: string): Promise<{
  addressDetailPath: string
  geocodePath: string
  streetLocalityPath: string
  localityPath: string
} | null> {
  try {
    const files = await readdir(gnafDir)
    const detail = files.find(f => f.endsWith('ADDRESS_DETAIL_psv.psv') && f.startsWith('NSW'))
    const geocode = files.find(f => f.endsWith('ADDRESS_DEFAULT_GEOCODE_psv.psv') && f.startsWith('NSW'))
    const streetLocality = files.find(f => f.endsWith('STREET_LOCALITY_psv.psv') && f.startsWith('NSW'))
    const locality = files.find(f => f.endsWith('LOCALITY_psv.psv') && f.startsWith('NSW') && !f.includes('ALIAS') && !f.includes('NEIGHBOUR') && !f.includes('POINT'))
    if (detail && geocode && streetLocality && locality) {
      return {
        addressDetailPath: join(gnafDir, detail),
        geocodePath: join(gnafDir, geocode),
        streetLocalityPath: join(gnafDir, streetLocality),
        localityPath: join(gnafDir, locality),
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return null
}

/**
 * Download the G-NAF ZIP from data.gov.au and extract NSW PSV files.
 *
 * @param gnafDir - Directory to store downloaded/extracted files (e.g. GNAFData/)
 * @param onProgress - Optional callback for download progress
 */
export async function downloadAndExtractGnaf(
  gnafDir: string,
  onProgress?: (downloadedMb: number, totalMb: number | null) => void,
): Promise<DownloadResult> {
  await mkdir(gnafDir, { recursive: true })

  const zipPath = join(gnafDir, 'g-naf-latest.zip')

  // Download the ZIP
  console.log('Downloading G-NAF from data.gov.au...')
  const downloadedBytes = await downloadFile(GNAF_DOWNLOAD_URL, zipPath, onProgress)
  console.log(`  Downloaded ${(downloadedBytes / 1024 / 1024).toFixed(0)}MB → ${zipPath}`)

  // Extract only NSW PSV files
  console.log('Extracting NSW address files...')
  const extractedFiles = await extractNswFiles(zipPath, gnafDir)
  for (const file of extractedFiles) {
    console.log(`  Extracted ${basename(file)}`)
  }

  return { zipPath, extractedFiles, downloadedBytes }
}

/** Download a file via HTTPS, following redirects. */
async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (downloadedMb: number, totalMb: number | null) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = (reqUrl: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'))
        return
      }

      const getter = reqUrl.startsWith('https') ? get : httpGet
      getter(reqUrl, (response: IncomingMessage) => {
        // Follow redirects
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          request(response.headers.location, redirectCount + 1)
          return
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${response.statusCode}`))
          return
        }

        const totalBytes = response.headers['content-length']
          ? parseInt(response.headers['content-length'], 10)
          : null
        let downloadedBytes = 0

        const writeStream = createWriteStream(destPath)

        response.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length
          if (onProgress) {
            onProgress(
              downloadedBytes / 1024 / 1024,
              totalBytes ? totalBytes / 1024 / 1024 : null,
            )
          }
        })

        pipeline(response, writeStream)
          .then(() => resolve(downloadedBytes))
          .catch(reject)
      }).on('error', reject)
    }

    request(url)
  })
}

/** Extract only NSW PSV files from the G-NAF ZIP. */
async function extractNswFiles(zipPath: string, outputDir: string): Promise<string[]> {
  const extractedFiles: string[] = []

  const zip = await yauzl.open(zipPath)
  try {
    for await (const entry of zip) {
      if (entry.filename.endsWith('/')) continue

      const filename = basename(entry.filename)
      if (!NSW_FILES_NEEDED.includes(filename)) continue

      const outputPath = join(outputDir, filename)
      const readStream = await entry.openReadStream()
      const writeStream = createWriteStream(outputPath)
      await pipeline(readStream, writeStream)
      extractedFiles.push(outputPath)

      if (extractedFiles.length === NSW_FILES_NEEDED.length) break
    }
  } finally {
    await zip.close()
  }

  if (extractedFiles.length !== NSW_FILES_NEEDED.length) {
    const missing = NSW_FILES_NEEDED.filter(f => !extractedFiles.some(e => e.endsWith(f)))
    throw new Error(`Missing NSW files in G-NAF ZIP: ${missing.join(', ')}`)
  }

  return extractedFiles
}
