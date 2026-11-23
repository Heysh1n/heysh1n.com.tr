import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { Readable } from 'stream'
import type { Endpoint, PayloadRequest } from 'payload'

import {
  getEffectiveReleaseTarget,
  type ReleaseChannel,
  type ReleaseDocument,
} from '../collections/Releases'
import {
  checkRateLimit,
  createRateLimitExceededResponse,
  createRateLimitHeaders,
  extractClientIp,
  parsePositiveIntEnv,
} from '../utils/rateLimit'
import {
  buildReleaseDownloadPath,
  getSafeDownloadContentType,
  isSafeReleaseFilename,
  isValidExternalDownloadUrl,
  isVsixFilenameOrUrl,
  resolvePublicBaseUrl,
  resolveSafeReleaseFilePath,
  sanitizeDownloadFilename,
  sanitizeErrorForLog,
} from '../utils/releaseStorage'
import { compareSemver, isValidSha256, normalizeSha256, normalizeVersion } from '../utils/semver'

const VALID_CHANNELS = new Set<ReleaseChannel>(['stable', 'beta', 'nightly'])

const PLATFORM_FALLBACK_PRIORITY = [
  'linux-x86_64',
  'windows-x86_64',
  'macos-arm64',
  'macos-x86_64',
  'darwin-arm64',
  'darwin-x86_64',
  'linux-aarch64',
  'windows-aarch64',
]

export interface PlatformManifestEntry {
  download_url: string
  sha256: string | null
  filename: string | null
  size: number | null
}

export interface SfcProUpdateManifest {
  product: 'sfc-pro'
  version: string
  latest_version: string
  channel: ReleaseChannel
  published_at: string | null
  notes: string | null
  download_url: string | null
  downloadUrl: string | null
  sha256: string | null
  platforms: Record<string, PlatformManifestEntry>
}

export interface VscodeUpdateManifest {
  product: 'sfcp-vscode'
  version: string
  latest_version: string
  channel: ReleaseChannel
  published_at: string | null
  notes: string | null
  download_url: string | null
  downloadUrl: string | null
  sha256: string | null
  filename: string | null
  size: number | null
}

const strictJson = (
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response =>
  Response.json(body, {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      ...(init.headers ?? {}),
    },
  })

const parseTimestamp = (value: string | null | undefined): number => {
  if (!value) return 0
  const ts = Date.parse(value)
  return Number.isNaN(ts) ? 0 : ts
}

const compareNumericOrStringId = (a: number | string, b: number | string): number => {
  const numA = typeof a === 'number' ? a : Number(a)
  const numB = typeof b === 'number' ? b : Number(b)

  if (Number.isFinite(numA) && Number.isFinite(numB)) {
    return numA - numB
  }

  return String(a).localeCompare(String(b))
}

const compareReleaseFreshness = (a: ReleaseDocument, b: ReleaseDocument): number => {
  const updatedDiff = parseTimestamp(a.updatedAt) - parseTimestamp(b.updatedAt)
  if (updatedDiff !== 0) return updatedDiff

  const createdDiff = parseTimestamp(a.createdAt) - parseTimestamp(b.createdAt)
  if (createdDiff !== 0) return createdDiff

  const publishedDiff = parseTimestamp(a.publishedAt) - parseTimestamp(b.publishedAt)
  if (publishedDiff !== 0) return publishedDiff

  return compareNumericOrStringId(a.id, b.id)
}

const compareReleasePrecedence = (a: ReleaseDocument, b: ReleaseDocument): number => {
  const semverDiff = compareSemver(a.version, b.version)
  if (semverDiff !== 0) return semverDiff

  return compareReleaseFreshness(a, b)
}

const resolveArtifactDownload = (
  doc: ReleaseDocument,
  baseUrl: string,
): { downloadUrl: string; filename: string | null; size: number | null } | null => {
  const safeFilename =
    typeof doc.filename === 'string' && isSafeReleaseFilename(doc.filename) ? doc.filename : null

  if (safeFilename) {
    return {
      downloadUrl: `${baseUrl}${buildReleaseDownloadPath(safeFilename)}`,
      filename: safeFilename,
      size: typeof doc.filesize === 'number' && Number.isFinite(doc.filesize) ? doc.filesize : null,
    }
  }

  if (typeof doc.downloadUrl === 'string' && isValidExternalDownloadUrl(doc.downloadUrl)) {
    let derivedFilename: string | null = null
    try {
      const parsed = new URL(doc.downloadUrl.trim())
      const lastSegment = parsed.pathname.split('/').filter(Boolean).pop()
      if (lastSegment) {
        const decoded = decodeURIComponent(lastSegment)
        if (isSafeReleaseFilename(decoded)) {
          derivedFilename = decoded
        }
      }
    } catch {
      // Ignore filename derivation errors
    }

    return {
      downloadUrl: doc.downloadUrl.trim(),
      filename: derivedFilename,
      size: typeof doc.filesize === 'number' && Number.isFinite(doc.filesize) ? doc.filesize : null,
    }
  }

  return null
}

const resolveNormalizedSha = (raw: string | null | undefined): string | null => {
  if (typeof raw !== 'string') return null
  const normalized = normalizeSha256(raw)
  return isValidSha256(normalized) ? normalized : null
}

const selectActiveVersion = (docs: ReleaseDocument[]): string => {
  const pinnedDocs = docs.filter((doc) => doc.isCurrent === true)
  const pool = pinnedDocs.length > 0 ? pinnedDocs : docs

  const sorted = [...pool].sort((a, b) => compareReleasePrecedence(b, a))
  return normalizeVersion(sorted[0].version)
}

const getQueryParams = (req: { url?: string }): URLSearchParams => {
  if (!req.url) {
    return new URLSearchParams()
  }

  try {
    return new URL(req.url, 'http://localhost').searchParams
  } catch {
    return new URLSearchParams()
  }
}

const resolveRequestedChannel = (params: URLSearchParams): ReleaseChannel => {
  const raw = params.get('channel')?.trim().toLowerCase()
  if (raw && VALID_CHANNELS.has(raw as ReleaseChannel)) {
    return raw as ReleaseChannel
  }
  return 'stable'
}

const resolveRequestedPlatform = (params: URLSearchParams): string | null => {
  const raw = (params.get('platform') || params.get('target'))?.trim().toLowerCase()
  if (!raw || raw.length > 64 || !/^[a-z0-9][a-z0-9._-]*$/.test(raw)) {
    return null
  }
  return raw
}

export const buildSfcProManifest = (
  docs: ReleaseDocument[],
  options: {
    baseUrl: string
    channel?: ReleaseChannel
    requestedPlatform?: string | null
    envFallback?: {
      version?: string
      downloadUrl?: string
      sha256?: string
    }
  },
): SfcProUpdateManifest => {
  const channel: ReleaseChannel = options.channel ?? 'stable'

  const eligible = docs.filter((doc) => {
    if (doc.status !== 'published') return false
    if (doc.product && doc.product !== 'sfc-pro') return false
    if ((doc.channel || 'stable') !== channel) return false
    const target = getEffectiveReleaseTarget(doc)
    if (!target || target === 'vscode') return false
    return resolveArtifactDownload(doc, options.baseUrl) !== null
  })

  if (eligible.length === 0) {
    const fallbackVersion =
      channel === 'stable' && options.envFallback?.version?.trim()
        ? normalizeVersion(options.envFallback.version)
        : '0.0.0'
    const rawFallbackUrl =
      channel === 'stable' && options.envFallback?.downloadUrl?.trim()
        ? options.envFallback.downloadUrl.trim()
        : null
    const fallbackUrl =
      rawFallbackUrl && isValidExternalDownloadUrl(rawFallbackUrl) ? rawFallbackUrl : null
    const fallbackSha =
      channel === 'stable' ? resolveNormalizedSha(options.envFallback?.sha256) : null

    return {
      product: 'sfc-pro',
      version: fallbackVersion,
      latest_version: fallbackVersion,
      channel,
      published_at: null,
      notes: null,
      download_url: fallbackUrl,
      downloadUrl: fallbackUrl,
      sha256: fallbackSha,
      platforms: {},
    }
  }

  const activeVersion = selectActiveVersion(eligible)
  const activeVersionDocs = eligible.filter(
    (doc) => normalizeVersion(doc.version) === activeVersion,
  )

  // Deduplicate multiple uploads for the same target by keeping the freshest record
  const latestByPlatform = new Map<string, ReleaseDocument>()
  for (const doc of activeVersionDocs) {
    const target = getEffectiveReleaseTarget(doc)
    const existing = latestByPlatform.get(target)
    if (!existing || compareReleaseFreshness(doc, existing) > 0) {
      latestByPlatform.set(target, doc)
    }
  }

  const sortedPlatformKeys = Array.from(latestByPlatform.keys()).sort((a, b) => a.localeCompare(b))
  const platforms: Record<string, PlatformManifestEntry> = {}

  let latestPublishedAt: string | null = null
  let latestPublishedTs = 0
  let notes: string | null = null

  for (const platformKey of sortedPlatformKeys) {
    const doc = latestByPlatform.get(platformKey)!
    const artifact = resolveArtifactDownload(doc, options.baseUrl)
    if (!artifact) continue

    platforms[platformKey] = {
      download_url: artifact.downloadUrl,
      sha256: resolveNormalizedSha(doc.sha256),
      filename: artifact.filename,
      size: artifact.size,
    }

    const publishedCandidate = doc.publishedAt || doc.updatedAt || doc.createdAt || null
    const candidateTs = parseTimestamp(publishedCandidate)
    if (publishedCandidate && candidateTs >= latestPublishedTs) {
      latestPublishedTs = candidateTs
      latestPublishedAt = publishedCandidate
    }

    if (!notes && typeof doc.notes === 'string' && doc.notes.trim().length > 0) {
      notes = doc.notes.trim()
    }
  }

  let fallbackEntry: PlatformManifestEntry | null = null
  if (options.requestedPlatform && platforms[options.requestedPlatform]) {
    fallbackEntry = platforms[options.requestedPlatform]
  } else {
    for (const preferred of PLATFORM_FALLBACK_PRIORITY) {
      if (platforms[preferred]) {
        fallbackEntry = platforms[preferred]
        break
      }
    }
    if (!fallbackEntry && sortedPlatformKeys.length > 0) {
      fallbackEntry = platforms[sortedPlatformKeys[0]] ?? null
    }
  }

  return {
    product: 'sfc-pro',
    version: activeVersion,
    latest_version: activeVersion,
    channel,
    published_at: latestPublishedAt,
    notes,
    download_url: fallbackEntry?.download_url ?? null,
    downloadUrl: fallbackEntry?.download_url ?? null,
    sha256: fallbackEntry?.sha256 ?? null,
    platforms,
  }
}

export const buildVscodeManifest = (
  docs: ReleaseDocument[],
  options: {
    baseUrl: string
    channel?: ReleaseChannel
    envFallback?: {
      version?: string
      downloadUrl?: string
      sha256?: string
    }
  },
): VscodeUpdateManifest => {
  const channel: ReleaseChannel = options.channel ?? 'stable'

  const eligible = docs.filter((doc) => {
    if (doc.status !== 'published') return false
    if ((doc.channel || 'stable') !== channel) return false
    const target = getEffectiveReleaseTarget(doc)
    const isVscodeRelease = doc.product === 'sfcp-vscode' || target === 'vscode'
    if (!isVscodeRelease) return false

    const artifact = resolveArtifactDownload(doc, options.baseUrl)
    if (!artifact) return false

    return isVsixFilenameOrUrl(artifact.filename || artifact.downloadUrl)
  })

  if (eligible.length === 0) {
    const fallbackVersion =
      channel === 'stable' && options.envFallback?.version?.trim()
        ? normalizeVersion(options.envFallback.version)
        : '0.0.0'
    const rawFallbackUrl =
      channel === 'stable' && options.envFallback?.downloadUrl?.trim()
        ? options.envFallback.downloadUrl.trim()
        : null
    const fallbackUrl =
      rawFallbackUrl &&
      isValidExternalDownloadUrl(rawFallbackUrl) &&
      isVsixFilenameOrUrl(rawFallbackUrl)
        ? rawFallbackUrl
        : null
    const fallbackSha =
      channel === 'stable' ? resolveNormalizedSha(options.envFallback?.sha256) : null

    return {
      product: 'sfcp-vscode',
      version: fallbackVersion,
      latest_version: fallbackVersion,
      channel,
      published_at: null,
      notes: null,
      download_url: fallbackUrl,
      downloadUrl: fallbackUrl,
      sha256: fallbackSha,
      filename: null,
      size: null,
    }
  }

  const activeVersion = selectActiveVersion(eligible)
  const matchingDocs = eligible
    .filter((doc) => normalizeVersion(doc.version) === activeVersion)
    .sort((a, b) => compareReleaseFreshness(b, a))

  const selected = matchingDocs[0]
  const artifact = resolveArtifactDownload(selected, options.baseUrl)!

  return {
    product: 'sfcp-vscode',
    version: activeVersion,
    latest_version: activeVersion,
    channel,
    published_at: selected.publishedAt || selected.updatedAt || selected.createdAt || null,
    notes: typeof selected.notes === 'string' && selected.notes.trim().length > 0
      ? selected.notes.trim()
      : null,
    download_url: artifact.downloadUrl,
    downloadUrl: artifact.downloadUrl,
    sha256: resolveNormalizedSha(selected.sha256),
    filename: artifact.filename,
    size: artifact.size,
  }
}

const checkManifestRateLimit = (req: { headers?: Headers }, bucket: string) =>
  checkRateLimit({
    bucket,
    key: extractClientIp(req),
    limit: parsePositiveIntEnv(process.env.SFCP_MANIFEST_RATE_LIMIT_MAX, 60),
    windowMs: parsePositiveIntEnv(process.env.SFCP_MANIFEST_RATE_LIMIT_WINDOW_MS, 60_000),
  })

const checkDownloadRateLimit = (req: { headers?: Headers }) =>
  checkRateLimit({
    bucket: 'sfcp-downloads',
    key: extractClientIp(req),
    limit: parsePositiveIntEnv(process.env.SFCP_DOWNLOAD_RATE_LIMIT_MAX, 30),
    windowMs: parsePositiveIntEnv(process.env.SFCP_DOWNLOAD_RATE_LIMIT_WINDOW_MS, 60_000),
  })

const fetchPublishedReleases = async (
  req: PayloadRequest,
  product: 'sfc-pro' | 'sfcp-vscode',
  channel: ReleaseChannel,
): Promise<ReleaseDocument[]> => {
  if (!req.payload || typeof req.payload.find !== 'function') {
    return []
  }

  const result = await req.payload.find({
    collection: 'releases',
    where: {
      and: [
        { product: { equals: product } },
        { channel: { equals: channel } },
        { status: { equals: 'published' } },
      ],
    },
    sort: '-updatedAt',
    depth: 0,
    limit: 500,
    overrideAccess: true,
  })

  return (result?.docs ?? []) as ReleaseDocument[]
}

export const updateManifestEndpoint: Endpoint = {
  method: 'get',
  path: '/sfcp/update.json',
  handler: async (req) => {
    const rateLimit = checkManifestRateLimit(req, 'sfcp-manifest-pro')
    if (!rateLimit.allowed) {
      return createRateLimitExceededResponse(rateLimit)
    }

    const rateHeaders = createRateLimitHeaders(rateLimit)

    try {
      const query = getQueryParams(req)
      const channel = resolveRequestedChannel(query)
      const requestedPlatform = resolveRequestedPlatform(query)
      const baseUrl = resolvePublicBaseUrl(req)
      const docs = await fetchPublishedReleases(req, 'sfc-pro', channel)

      const manifest = buildSfcProManifest(docs, {
        baseUrl,
        channel,
        requestedPlatform,
        envFallback: {
          version: process.env.SFCP_LATEST_VERSION,
          downloadUrl: process.env.SFCP_DOWNLOAD_URL,
          sha256: process.env.SFCP_SHA256,
        },
      })

      return strictJson(manifest, { status: 200, headers: rateHeaders })
    } catch (error) {
      req.payload?.logger?.error?.(
        { error: sanitizeErrorForLog(error) },
        '[sfcp] Failed to generate sfc-pro update manifest',
      )

      return strictJson(
        { error: 'Unable to load update manifest.' },
        { status: 503, headers: rateHeaders },
      )
    }
  },
}

export const vscodeUpdateManifestEndpoint: Endpoint = {
  method: 'get',
  path: '/sfcp/vscode-update.json',
  handler: async (req) => {
    const rateLimit = checkManifestRateLimit(req, 'sfcp-manifest-vscode')
    if (!rateLimit.allowed) {
      return createRateLimitExceededResponse(rateLimit)
    }

    const rateHeaders = createRateLimitHeaders(rateLimit)

    try {
      const query = getQueryParams(req)
      const channel = resolveRequestedChannel(query)
      const baseUrl = resolvePublicBaseUrl(req)
      const docs = await fetchPublishedReleases(req, 'sfcp-vscode', channel)

      const manifest = buildVscodeManifest(docs, {
        baseUrl,
        channel,
        envFallback: {
          version: process.env.SFCP_VSCODE_LATEST_VERSION,
          downloadUrl: process.env.SFCP_VSCODE_DOWNLOAD_URL,
          sha256: process.env.SFCP_VSCODE_SHA256,
        },
      })

      return strictJson(manifest, { status: 200, headers: rateHeaders })
    } catch (error) {
      req.payload?.logger?.error?.(
        { error: sanitizeErrorForLog(error) },
        '[sfcp] Failed to generate sfcp-vscode update manifest',
      )

      return strictJson(
        { error: 'Unable to load VS Code update manifest.' },
        { status: 503, headers: rateHeaders },
      )
    }
  },
}

const extractFilenameParam = (req: PayloadRequest): string | null => {
  const fromRouteParams = req.routeParams?.filename
  if (typeof fromRouteParams === 'string' && fromRouteParams.length > 0) {
    return fromRouteParams
  }

  if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://localhost')
      const prefix = '/api/sfcp/downloads/'
      const idx = parsed.pathname.indexOf(prefix)
      if (idx !== -1) {
        const rawSegment = parsed.pathname.slice(idx + prefix.length)
        if (!rawSegment || rawSegment.includes('/')) {
          return null
        }
        return decodeURIComponent(rawSegment)
      }
    } catch {
      return null
    }
  }

  return null
}

const handleReleaseDownload = async (req: PayloadRequest, headOnly: boolean): Promise<Response> => {
  const rateLimit = checkDownloadRateLimit(req)
  if (!rateLimit.allowed) {
    return createRateLimitExceededResponse(rateLimit)
  }

  const rateHeaders = createRateLimitHeaders(rateLimit)

  const filename = extractFilenameParam(req)
  if (!filename || !isSafeReleaseFilename(filename)) {
    return strictJson({ error: 'Invalid release filename.' }, { status: 400, headers: rateHeaders })
  }

  let releaseDoc: ReleaseDocument | undefined
  try {
    const result = await req.payload.find({
      collection: 'releases',
      where: {
        and: [{ filename: { equals: filename } }, { status: { equals: 'published' } }],
      },
      depth: 0,
      limit: 1,
      overrideAccess: true,
    })
    releaseDoc = (result?.docs ?? [])[0] as ReleaseDocument | undefined
  } catch (error) {
    req.payload?.logger?.error?.(
      { error: sanitizeErrorForLog(error) },
      '[sfcp] Failed to look up release file metadata',
    )
    return strictJson(
      { error: 'Unable to serve release file.' },
      { status: 503, headers: rateHeaders },
    )
  }

  if (!releaseDoc) {
    return strictJson({ error: 'Release file not found.' }, { status: 404, headers: rateHeaders })
  }

  const safeFilePath = resolveSafeReleaseFilePath(filename)
  if (!safeFilePath) {
    return strictJson({ error: 'Invalid release filename.' }, { status: 400, headers: rateHeaders })
  }

  let fileSize: number
  try {
    const fileStats = await stat(safeFilePath)
    if (!fileStats.isFile()) {
      return strictJson({ error: 'Release file not found.' }, { status: 404, headers: rateHeaders })
    }
    fileSize = fileStats.size
  } catch (error) {
    const safeErr = sanitizeErrorForLog(error)
    if (safeErr.code === 'ENOENT') {
      return strictJson({ error: 'Release file not found.' }, { status: 404, headers: rateHeaders })
    }
    req.payload?.logger?.error?.(
      { error: safeErr, releaseId: releaseDoc.id },
      '[sfcp] Failed to stat release artifact',
    )
    return strictJson(
      { error: 'Unable to serve release file.' },
      { status: 500, headers: rateHeaders },
    )
  }

  const downloadHeaders: Record<string, string> = {
    'Content-Type': getSafeDownloadContentType(filename),
    'Content-Length': String(fileSize),
    'Content-Disposition': `attachment; filename="${sanitizeDownloadFilename(filename)}"`,
    'Cache-Control': 'public, max-age=3600, no-transform',
    'X-Content-Type-Options': 'nosniff',
    ...rateHeaders,
  }

  const sha = resolveNormalizedSha(releaseDoc.sha256)
  if (sha) {
    downloadHeaders.ETag = `"sha256-${sha}"`
    downloadHeaders['X-Checksum-Sha256'] = sha
  }

  if (headOnly || req.method?.toUpperCase() === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: downloadHeaders,
    })
  }

  try {
    const nodeStream = createReadStream(safeFilePath)
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>

    return new Response(webStream, {
      status: 200,
      headers: downloadHeaders,
    })
  } catch (error) {
    req.payload?.logger?.error?.(
      { error: sanitizeErrorForLog(error), releaseId: releaseDoc.id },
      '[sfcp] Failed to open release artifact stream',
    )
    return strictJson(
      { error: 'Unable to serve release file.' },
      { status: 500, headers: rateHeaders },
    )
  }
}

export const releaseDownloadEndpoint: Endpoint = {
  method: 'get',
  path: '/sfcp/downloads/:filename',
  handler: (req) => handleReleaseDownload(req, false),
}

export const releaseDownloadHeadEndpoint: Endpoint = {
  method: 'head',
  path: '/sfcp/downloads/:filename',
  handler: (req) => handleReleaseDownload(req, true),
}
