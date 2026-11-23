import { APIError } from 'payload'
import type {
  CollectionAfterChangeHook,
  CollectionBeforeValidateHook,
  CollectionConfig,
} from 'payload'

import {
  compareSemver,
  computeBufferSha256,
  computeFileSha256,
  isValidSemver,
  isValidSha256,
  normalizeSha256,
  normalizeVersion,
} from '../utils/semver'
import {
  getReleasesDir,
  isBlockedUploadFilename,
  isValidExternalDownloadUrl,
  isVsixFilenameOrUrl,
  sanitizeErrorForLog,
} from '../utils/releaseStorage'
import { isAdminOrOwner } from './Users'

export type ReleaseProduct = 'sfc-pro' | 'sfcp-vscode'
export type ReleaseChannel = 'stable' | 'beta' | 'nightly'
export type ReleaseStatus = 'published' | 'draft' | 'archived'
export type ReleaseTarget =
  | 'linux-x86_64'
  | 'linux-aarch64'
  | 'windows-x86_64'
  | 'windows-aarch64'
  | 'macos-x86_64'
  | 'macos-arm64'
  | 'darwin-x86_64'
  | 'darwin-arm64'
  | 'vscode'
  | 'custom'

export interface ReleaseDocument {
  id: number | string
  releaseLabel?: string | null
  product: ReleaseProduct
  version: string
  target: ReleaseTarget
  customTarget?: string | null
  channel?: ReleaseChannel | null
  status?: ReleaseStatus | null
  isCurrent?: boolean | null
  downloadUrl?: string | null
  sha256?: string | null
  notes?: string | null
  publishedAt?: string | null
  filename?: string | null
  mimeType?: string | null
  filesize?: number | null
  url?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export const RELEASE_PRODUCT_OPTIONS = [
  { label: 'SFC Pro (CLI / App)', value: 'sfc-pro' },
  { label: 'SFCP VS Code Extension', value: 'sfcp-vscode' },
] satisfies Array<{ label: string; value: ReleaseProduct }>

export const RELEASE_CHANNEL_OPTIONS = [
  { label: 'Stable', value: 'stable' },
  { label: 'Beta', value: 'beta' },
  { label: 'Nightly', value: 'nightly' },
] satisfies Array<{ label: string; value: ReleaseChannel }>

export const RELEASE_STATUS_OPTIONS = [
  { label: 'Published', value: 'published' },
  { label: 'Draft', value: 'draft' },
  { label: 'Archived', value: 'archived' },
] satisfies Array<{ label: string; value: ReleaseStatus }>

export const RELEASE_TARGET_OPTIONS = [
  { label: 'Linux x86_64 (linux-x86_64)', value: 'linux-x86_64' },
  { label: 'Linux ARM64 (linux-aarch64)', value: 'linux-aarch64' },
  { label: 'Windows x86_64 (windows-x86_64)', value: 'windows-x86_64' },
  { label: 'Windows ARM64 (windows-aarch64)', value: 'windows-aarch64' },
  { label: 'macOS Apple Silicon (macos-arm64)', value: 'macos-arm64' },
  { label: 'macOS Intel (macos-x86_64)', value: 'macos-x86_64' },
  { label: 'Darwin Apple Silicon (darwin-arm64)', value: 'darwin-arm64' },
  { label: 'Darwin Intel (darwin-x86_64)', value: 'darwin-x86_64' },
  { label: 'VS Code Extension (vscode)', value: 'vscode' },
  { label: 'Custom Target', value: 'custom' },
] satisfies Array<{ label: string; value: ReleaseTarget }>

const KNOWN_RELEASE_TARGETS = new Set<string>(RELEASE_TARGET_OPTIONS.map((option) => option.value))
const CUSTOM_TARGET_REGEX = /^[a-z0-9][a-z0-9._-]{1,63}$/

export const getEffectiveReleaseTarget = (doc: {
  target?: string | null
  customTarget?: string | null
}): string => {
  if (doc.target === 'custom') {
    return typeof doc.customTarget === 'string' ? doc.customTarget.trim().toLowerCase() : ''
  }

  return typeof doc.target === 'string' ? doc.target.trim().toLowerCase() : ''
}

const computeUploadedFileSha256 = async (file: {
  data?: Buffer | Uint8Array
  tempFilePath?: string
}): Promise<string | null> => {
  if (typeof file.tempFilePath === 'string' && file.tempFilePath.trim().length > 0) {
    return computeFileSha256(file.tempFilePath)
  }

  if (Buffer.isBuffer(file.data) || file.data instanceof Uint8Array) {
    return computeBufferSha256(file.data)
  }

  return null
}

export const prepareReleaseData: CollectionBeforeValidateHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (!data || typeof data !== 'object') {
    return data
  }

  const nextData: Record<string, unknown> = { ...data }
  const prevDoc = (originalDoc ?? {}) as Partial<ReleaseDocument>

  // Normalize version string (strips optional leading 'v')
  if (typeof nextData.version === 'string') {
    nextData.version = normalizeVersion(nextData.version)
  }

  // Allow API callers to pass an unlisted valid OS/arch slug directly in `target`
  if (typeof nextData.target === 'string') {
    const normalizedTarget = nextData.target.trim().toLowerCase()
    if (normalizedTarget && !KNOWN_RELEASE_TARGETS.has(normalizedTarget)) {
      if (CUSTOM_TARGET_REGEX.test(normalizedTarget)) {
        nextData.customTarget = normalizedTarget
        nextData.target = 'custom'
      }
    } else if (normalizedTarget) {
      nextData.target = normalizedTarget
    }
  }

  if (typeof nextData.customTarget === 'string') {
    nextData.customTarget = nextData.customTarget.trim().toLowerCase()
  }

  const resolvedTarget =
    nextData.target !== undefined ? String(nextData.target ?? '') : String(prevDoc.target ?? '')
  let resolvedProduct =
    nextData.product !== undefined ? String(nextData.product ?? '') : String(prevDoc.product ?? '')

  // Infer product / target when one side is omitted
  if (!resolvedProduct) {
    resolvedProduct = resolvedTarget === 'vscode' ? 'sfcp-vscode' : 'sfc-pro'
    nextData.product = resolvedProduct
  }

  if (!resolvedTarget && resolvedProduct === 'sfcp-vscode') {
    nextData.target = 'vscode'
  }

  const finalTarget =
    nextData.target !== undefined ? String(nextData.target ?? '') : String(prevDoc.target ?? '')
  const finalCustomTarget =
    nextData.customTarget !== undefined
      ? String(nextData.customTarget ?? '')
      : String(prevDoc.customTarget ?? '')
  const effectiveTarget = finalTarget === 'custom' ? finalCustomTarget : finalTarget

  if (resolvedProduct === 'sfcp-vscode' && effectiveTarget !== 'vscode') {
    throw new APIError('sfcp-vscode releases must use target "vscode".', 400, undefined, true)
  }

  if (resolvedProduct === 'sfc-pro' && effectiveTarget === 'vscode') {
    throw new APIError(
      'sfc-pro releases cannot use target "vscode". Choose an OS/architecture target.',
      400,
      undefined,
      true,
    )
  }

  if (finalTarget === 'custom' && !CUSTOM_TARGET_REGEX.test(finalCustomTarget)) {
    throw new APIError(
      'Custom target must match ^[a-z0-9][a-z0-9._-]{1,63}$ (e.g. linux-arm64).',
      400,
      undefined,
      true,
    )
  }

  // Normalize external downloadUrl if provided
  if (typeof nextData.downloadUrl === 'string') {
    const trimmedUrl = nextData.downloadUrl.trim()
    nextData.downloadUrl = trimmedUrl.length > 0 ? trimmedUrl : null
  }

  const uploadedFile = req?.file
  const uploadedFileName = typeof uploadedFile?.name === 'string' ? uploadedFile.name : ''
  const effectiveFilename =
    uploadedFileName ||
    (nextData.filename !== undefined
      ? typeof nextData.filename === 'string'
        ? nextData.filename
        : ''
      : typeof prevDoc.filename === 'string'
        ? prevDoc.filename
        : '')
  const effectiveDownloadUrl =
    nextData.downloadUrl !== undefined
      ? typeof nextData.downloadUrl === 'string'
        ? nextData.downloadUrl
        : ''
      : typeof prevDoc.downloadUrl === 'string'
        ? prevDoc.downloadUrl
        : ''

  if (effectiveFilename && isBlockedUploadFilename(effectiveFilename)) {
    throw new APIError('Unsupported or unsafe release file extension.', 400, undefined, true)
  }

  if (effectiveDownloadUrl && !isValidExternalDownloadUrl(effectiveDownloadUrl)) {
    throw new APIError(
      'External download URL must be a valid http(s) URL without embedded credentials.',
      400,
      undefined,
      true,
    )
  }

  if (!effectiveFilename && !effectiveDownloadUrl) {
    throw new APIError(
      'Either upload a release file or provide an external download URL.',
      400,
      undefined,
      true,
    )
  }

  if (resolvedProduct === 'sfcp-vscode') {
    const artifactSource = effectiveFilename || effectiveDownloadUrl
    if (!isVsixFilenameOrUrl(artifactSource)) {
      throw new APIError(
        'VS Code extension releases must upload a .vsix package or reference a .vsix download URL.',
        400,
        undefined,
        true,
      )
    }
  }

  // Normalize sha256 and auto-calculate from uploaded file if omitted or file was replaced
  const rawIncomingSha = typeof nextData.sha256 === 'string' ? normalizeSha256(nextData.sha256) : ''
  const previousSha = typeof prevDoc.sha256 === 'string' ? normalizeSha256(prevDoc.sha256) : ''

  if (typeof nextData.sha256 === 'string') {
    nextData.sha256 = rawIncomingSha.length > 0 ? rawIncomingSha : null
  }

  const shouldAutoComputeSha =
    Boolean(uploadedFile) &&
    (!rawIncomingSha || (operation === 'update' && rawIncomingSha === previousSha))

  if (shouldAutoComputeSha && uploadedFile) {
    try {
      const computedSha = await computeUploadedFileSha256(uploadedFile)
      if (computedSha) {
        nextData.sha256 = computedSha
      }
    } catch (error) {
      req.payload?.logger?.error?.(
        { error: sanitizeErrorForLog(error) },
        '[sfcp-releases] Failed to compute SHA-256 for uploaded release file',
      )
      throw new APIError('Failed to compute SHA-256 checksum for uploaded file.', 500, undefined, true)
    }
  }

  const resolvedStatus =
    nextData.status !== undefined
      ? String(nextData.status ?? '')
      : String(prevDoc.status ?? 'published')

  if (
    resolvedStatus === 'published' &&
    !nextData.publishedAt &&
    !prevDoc.publishedAt
  ) {
    nextData.publishedAt = new Date().toISOString()
  }

  const resolvedVersion =
    nextData.version !== undefined ? String(nextData.version ?? '') : String(prevDoc.version ?? '')

  if (resolvedProduct && resolvedVersion && effectiveTarget) {
    nextData.releaseLabel = `${resolvedProduct} v${resolvedVersion} (${effectiveTarget})`
  }

  return nextData
}

export const syncCurrentReleaseVersion: CollectionAfterChangeHook = async ({
  doc,
  operation,
  req,
}) => {
  if (req.context?.skipReleasePinSync) {
    return doc
  }

  const release = doc as ReleaseDocument
  if (!release || release.status !== 'published' || !release.product || !release.version) {
    return doc
  }

  const channel = release.channel || 'stable'

  try {
    // Find any currently pinned releases for the same product & channel
    const pinnedResult = await req.payload.find({
      collection: 'releases',
      where: {
        and: [
          { product: { equals: release.product } },
          { channel: { equals: channel } },
          { isCurrent: { equals: true } },
        ],
      },
      depth: 0,
      limit: 100,
      overrideAccess: true,
      req,
    })

    const pinnedDocs = (pinnedResult?.docs ?? []) as ReleaseDocument[]
    const docsToUnpin = pinnedDocs.filter((candidate) => {
      if (candidate.id === release.id) {
        return false
      }

      const candidateVersion = normalizeVersion(candidate.version)
      const currentVersion = normalizeVersion(release.version)

      if (candidateVersion === currentVersion) {
        return false
      }

      // If this release was explicitly pinned, unpin all other versions
      if (release.isCurrent) {
        return true
      }

      // If a brand-new higher SemVer release is uploaded, automatically clear older pins
      return operation === 'create' && compareSemver(currentVersion, candidateVersion) > 0
    })

    const originalFile = req.file
    try {
      for (const staleDoc of docsToUnpin) {
        await req.payload.update({
          collection: 'releases',
          id: staleDoc.id,
          data: {
            isCurrent: false,
          },
          overrideAccess: true,
          context: {
            ...req.context,
            skipReleasePinSync: true,
          },
          req,
        })
      }
    } finally {
      req.file = originalFile
    }
  } catch (error) {
    req.payload?.logger?.warn?.(
      { error: sanitizeErrorForLog(error), releaseId: release.id },
      '[sfcp-releases] Failed to sync pinned release flags',
    )
  }

  return doc
}

export const Releases: CollectionConfig = {
  slug: 'releases',
  access: {
    read: isAdminOrOwner,
    create: isAdminOrOwner,
    update: isAdminOrOwner,
    delete: isAdminOrOwner,
  },
  labels: {
    singular: 'SFCP Release',
    plural: 'SFCP Releases',
  },
  admin: {
    useAsTitle: 'releaseLabel',
    group: 'SFC Pro Management',
    defaultColumns: ['releaseLabel', 'product', 'version', 'target', 'channel', 'status', 'isCurrent', 'updatedAt'],
  },
  typescript: {
    interface: 'Release',
  },
  upload: {
    staticDir: getReleasesDir(),
    filesRequiredOnCreate: false,
    crop: false,
    focalPoint: false,
    pasteURL: false,
    modifyResponseHeaders: ({ headers }) => {
      headers.set('X-Content-Type-Options', 'nosniff')
      if (!headers.has('Content-Disposition')) {
        headers.set('Content-Disposition', 'attachment')
      }
      return headers
    },
  },
  hooks: {
    beforeValidate: [prepareReleaseData],
    afterChange: [syncCurrentReleaseVersion],
  },
  fields: [
    {
      name: 'releaseLabel',
      label: 'Release',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'Auto-generated identifier (product, version, target).',
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'product',
          label: 'Product',
          type: 'select',
          options: RELEASE_PRODUCT_OPTIONS,
          defaultValue: 'sfc-pro',
          required: true,
          index: true,
          admin: {
            description: 'Target product manifest (sfc-pro -> update.json, sfcp-vscode -> vscode-update.json).',
          },
        },
        {
          name: 'version',
          label: 'Version (SemVer)',
          type: 'text',
          required: true,
          index: true,
          validate: (value: unknown) => {
            if (typeof value !== 'string' || !isValidSemver(value)) {
              return 'Version must follow SemVer format (e.g. 1.2.0 or 1.2.0-beta.1).'
            }
            return true
          },
          admin: {
            description: 'Semantic version string, e.g. 1.2.0 (leading "v" is stripped automatically).',
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'target',
          label: 'Target / Platform',
          type: 'select',
          options: RELEASE_TARGET_OPTIONS,
          defaultValue: 'linux-x86_64',
          required: true,
          index: true,
          admin: {
            description: 'OS/architecture target for sfc-pro (e.g. linux-x86_64, windows-x86_64) or "vscode" for sfcp-vscode.',
          },
        },
        {
          name: 'customTarget',
          label: 'Custom Target Key',
          type: 'text',
          admin: {
            condition: (data) => data?.target === 'custom',
            description: 'Custom platform key used in the manifest (e.g. linux-arm64, freebsd-x86_64).',
          },
          validate: (value: unknown, { siblingData }: { siblingData?: Record<string, unknown> }) => {
            if (siblingData?.target === 'custom') {
              if (typeof value !== 'string' || !CUSTOM_TARGET_REGEX.test(value.trim().toLowerCase())) {
                return 'Custom target must match ^[a-z0-9][a-z0-9._-]{1,63}$.'
              }
            }
            return true
          },
        },
      ],
    },
    {
      name: 'downloadUrl',
      label: 'External Download URL (Optional)',
      type: 'text',
      validate: (value: unknown) => {
        if (value === null || value === undefined || value === '') {
          return true
        }
        if (typeof value !== 'string' || !isValidExternalDownloadUrl(value)) {
          return 'Must be a valid http(s) URL without embedded credentials.'
        }
        return true
      },
      admin: {
        description:
          'Optional external download link. Leave blank when uploading the release file directly above — the download link is generated automatically.',
      },
    },
    {
      name: 'sha256',
      label: 'SHA-256 Checksum',
      type: 'text',
      validate: (value: unknown) => {
        if (value === null || value === undefined || value === '') {
          return true
        }
        if (typeof value !== 'string' || !isValidSha256(value)) {
          return 'SHA-256 must be a 64-character lowercase hexadecimal string.'
        }
        return true
      },
      admin: {
        description:
          'Automatically calculated when uploading a file if left empty. Can also be supplied manually for external links.',
      },
    },
    {
      name: 'notes',
      label: 'Release Notes',
      type: 'textarea',
      admin: {
        description: 'Optional changelog or release notes included in the manifest.',
      },
    },
    {
      name: 'channel',
      label: 'Channel',
      type: 'select',
      options: RELEASE_CHANNEL_OPTIONS,
      defaultValue: 'stable',
      required: true,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Release channel served by update endpoints (default: stable).',
      },
    },
    {
      name: 'status',
      label: 'Status',
      type: 'select',
      options: RELEASE_STATUS_OPTIONS,
      defaultValue: 'published',
      required: true,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Only published releases are included in manifests and available for public download.',
      },
    },
    {
      name: 'isCurrent',
      label: 'Pin as Current Version',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description:
          'Optional manual override (e.g. for rollbacks). By default, the highest published SemVer version is served automatically.',
      },
    },
    {
      name: 'publishedAt',
      label: 'Published At',
      type: 'date',
      admin: {
        position: 'sidebar',
        date: {
          pickerAppearance: 'dayAndTime',
        },
        description: 'Auto-populated when a release is published.',
      },
    },
  ],
}
