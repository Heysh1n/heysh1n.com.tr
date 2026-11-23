import { createHash } from 'crypto'
import { createReadStream } from 'fs'

const SEMVER_REGEX =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

const SHA256_REGEX = /^[a-f0-9]{64}$/

export interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

export const normalizeVersion = (raw: string): string => raw.trim().replace(/^[vV](?=\d)/, '')

export const parseSemver = (raw: string): ParsedSemver | null => {
  const normalized = normalizeVersion(raw)
  const match = SEMVER_REGEX.exec(normalized)

  if (!match) {
    return null
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

export const isValidSemver = (raw: string): boolean => parseSemver(raw) !== null

const comparePrereleaseIdentifier = (a: string, b: string): number => {
  const aIsNum = /^\d+$/.test(a)
  const bIsNum = /^\d+$/.test(b)

  if (aIsNum && bIsNum) {
    return Number(a) - Number(b)
  }

  // SemVer 2.0.0: numeric identifiers always have lower precedence than non-numeric
  if (aIsNum && !bIsNum) return -1
  if (!aIsNum && bIsNum) return 1

  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * Compares two version strings according to SemVer 2.0.0 precedence.
 * Returns > 0 if a > b, < 0 if a < b, 0 if equal.
 */
export const compareSemver = (a: string, b: string): number => {
  const parsedA = parseSemver(a)
  const parsedB = parseSemver(b)

  if (!parsedA && !parsedB) {
    return normalizeVersion(a).localeCompare(normalizeVersion(b))
  }
  if (!parsedA) return -1
  if (!parsedB) return 1

  if (parsedA.major !== parsedB.major) return parsedA.major - parsedB.major
  if (parsedA.minor !== parsedB.minor) return parsedA.minor - parsedB.minor
  if (parsedA.patch !== parsedB.patch) return parsedA.patch - parsedB.patch

  const preA = parsedA.prerelease
  const preB = parsedB.prerelease

  if (preA.length === 0 && preB.length === 0) return 0
  // Release version has higher precedence than pre-release
  if (preA.length === 0) return 1
  if (preB.length === 0) return -1

  const minLen = Math.min(preA.length, preB.length)
  for (let i = 0; i < minLen; i++) {
    const diff = comparePrereleaseIdentifier(preA[i], preB[i])
    if (diff !== 0) return diff
  }

  return preA.length - preB.length
}

export const normalizeSha256 = (raw: string): string => raw.trim().toLowerCase()

export const isValidSha256 = (raw: string): boolean => SHA256_REGEX.test(normalizeSha256(raw))

export const computeBufferSha256 = (data: Buffer | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex')

export const computeFileSha256 = (filePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)

    stream.on('data', (chunk) => {
      hash.update(chunk)
    })
    stream.on('error', (error) => {
      reject(error)
    })
    stream.on('end', () => {
      resolve(hash.digest('hex'))
    })
  })
