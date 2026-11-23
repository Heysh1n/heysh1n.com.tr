import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_RELEASES_DIR = path.resolve(__dirname, '../../releases')

const ALLOWED_REQUEST_HOSTS = new Set([
  'heysh1n.com.tr',
  'www.heysh1n.com.tr',
  'api.heysh1n.com.tr',
  'localhost',
  '127.0.0.1',
])

const BLOCKED_UPLOAD_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.xhtml',
  '.svg',
  '.js',
  '.mjs',
  '.cjs',
  '.php',
  '.jsp',
  '.asp',
  '.aspx',
])

const SAFE_DOWNLOAD_MIME_BY_EXT: Record<string, string> = {
  '.vsix': 'application/vsix',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tgz': 'application/gzip',
  '.xz': 'application/x-xz',
  '.zst': 'application/zstd',
  '.tar': 'application/x-tar',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.msi': 'application/x-msi',
  '.deb': 'application/vnd.debian.binary-package',
  '.rpm': 'application/x-rpm',
  '.appimage': 'application/octet-stream',
  '.dmg': 'application/octet-stream',
  '.pkg': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.sha256': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

export const getReleasesDir = (): string => {
  const envDir = process.env.SFCP_RELEASES_DIR?.trim()
  return envDir ? path.resolve(envDir) : DEFAULT_RELEASES_DIR
}

/**
 * Validates that a release filename is a plain basename with no traversal or control chars.
 */
export const isSafeReleaseFilename = (filename: string): boolean => {
  if (!filename || filename.length > 255) {
    return false
  }

  // Reject slashes, backslashes, null bytes, control chars, or dot-only segments
  if (
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..') ||
    /[\x00-\x1f\x7f]/.test(filename) ||
    filename.startsWith('.')
  ) {
    return false
  }

  return path.basename(filename) === filename
}

export const isBlockedUploadFilename = (filename: string): boolean => {
  const lower = filename.trim().toLowerCase()
  const ext = path.extname(lower)
  return BLOCKED_UPLOAD_EXTENSIONS.has(ext)
}

export const isVsixFilenameOrUrl = (value: string): boolean => {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }

  try {
    const parsed = new URL(trimmed)
    return parsed.pathname.toLowerCase().endsWith('.vsix')
  } catch {
    return trimmed.toLowerCase().endsWith('.vsix')
  }
}

export const isValidExternalDownloadUrl = (value: string): boolean => {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 2048) {
    return false
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false
    }
    // Disallow embedded credentials in download URLs
    if (parsed.username || parsed.password) {
      return false
    }
    return Boolean(parsed.hostname)
  } catch {
    return false
  }
}

/**
 * Resolves a release file path strictly contained inside the releases storage directory.
 * Returns null if the filename or resolved path attempts directory traversal.
 */
export const resolveSafeReleaseFilePath = (
  filename: string,
  baseDir: string = getReleasesDir(),
): string | null => {
  if (!isSafeReleaseFilename(filename)) {
    return null
  }

  const resolvedBase = path.resolve(baseDir)
  const resolvedTarget = path.resolve(resolvedBase, filename)

  if (
    resolvedTarget === resolvedBase ||
    !resolvedTarget.startsWith(`${resolvedBase}${path.sep}`)
  ) {
    return null
  }

  return resolvedTarget
}

export const getSafeDownloadContentType = (filename: string): string => {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.tar.gz')) {
    return 'application/gzip'
  }
  if (lower.endsWith('.tar.xz')) {
    return 'application/x-xz'
  }
  if (lower.endsWith('.tar.zst')) {
    return 'application/zstd'
  }

  const ext = path.extname(lower)
  return SAFE_DOWNLOAD_MIME_BY_EXT[ext] || 'application/octet-stream'
}

export const sanitizeDownloadFilename = (filename: string): string =>
  path.basename(filename).replace(/[^a-zA-Z0-9._+-]/g, '_')

/**
 * Extracts only safe, non-sensitive error metadata for logs.
 * Never includes absolute server paths, connection strings, or stack traces.
 */
export const sanitizeErrorForLog = (error: unknown): { name: string; code?: string } => {
  if (!error || typeof error !== 'object') {
    return { name: 'UnknownError' }
  }

  const record = error as { name?: unknown; code?: unknown }
  const name =
    typeof record.name === 'string' && record.name.length > 0 && record.name.length <= 64
      ? record.name
      : 'Error'
  const code =
    typeof record.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(record.code)
      ? record.code
      : undefined

  return code ? { name, code } : { name }
}

const normalizeOrigin = (rawUrl: string | undefined): string | null => {
  if (!rawUrl) {
    return null
  }

  try {
    const parsed = new URL(rawUrl.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

const isAllowedHostname = (hostname: string): boolean => {
  const lower = hostname.toLowerCase()
  if (ALLOWED_REQUEST_HOSTS.has(lower)) {
    return true
  }

  const extra = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => {
      try {
        return new URL(origin.trim()).hostname.toLowerCase()
      } catch {
        return ''
      }
    })
    .filter(Boolean)

  return extra.includes(lower)
}

/**
 * Resolves the canonical public base URL for building manifest download links.
 * Prioritizes configured public server URLs to prevent Host header spoofing and internal address leaks.
 */
export const resolvePublicBaseUrl = (req?: { headers?: Headers; url?: string }): string => {
  const configured =
    normalizeOrigin(process.env.PUBLIC_BACKEND_URL) ||
    normalizeOrigin(process.env.PAYLOAD_PUBLIC_SERVER_URL) ||
    normalizeOrigin(process.env.NEXT_PUBLIC_SERVER_URL)

  if (configured) {
    return configured
  }

  if (req?.headers && typeof req.headers.get === 'function') {
    const rawHost = req.headers.get('host')?.trim()
    if (rawHost && !/[\s/\\@]/.test(rawHost)) {
      const hostname = rawHost.split(':')[0] || ''
      if (isAllowedHostname(hostname)) {
        const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
        const proto =
          forwardedProto === 'https' || forwardedProto === 'http'
            ? forwardedProto
            : hostname === 'localhost' || hostname === '127.0.0.1'
              ? 'http'
              : 'https'
        return `${proto}://${rawHost}`
      }
    }
  }

  if (req?.url) {
    try {
      const parsed = new URL(req.url)
      if (isAllowedHostname(parsed.hostname)) {
        return `${parsed.protocol}//${parsed.host}`
      }
    } catch {
      // Ignore malformed request URL
    }
  }

  return 'http://localhost:3000'
}

export const buildReleaseDownloadPath = (filename: string): string =>
  `/api/sfcp/downloads/${encodeURIComponent(filename)}`
