import { createHash } from 'crypto'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  prepareReleaseData,
  Releases,
  syncCurrentReleaseVersion,
  type ReleaseDocument,
} from '@/collections/Releases'
import {
  buildSfcProManifest,
  buildVscodeManifest,
  releaseDownloadEndpoint,
  releaseDownloadHeadEndpoint,
  updateManifestEndpoint,
  vscodeUpdateManifestEndpoint,
} from '@/endpoints/releases'
import { validateLicenseEndpoint } from '@/endpoints/sfcp'
import { middleware } from '@/middleware'
import { resetRateLimitStore } from '@/utils/rateLimit'
import { NextRequest } from 'next/server'
import { compareSemver, computeBufferSha256, computeFileSha256, normalizeVersion } from '@/utils/semver'

const sha256Hex = (content: string | Buffer): string =>
  createHash('sha256').update(content).digest('hex')

const ENV_KEYS = [
  'SFCP_RELEASES_DIR',
  'SFCP_LATEST_VERSION',
  'SFCP_DOWNLOAD_URL',
  'SFCP_SHA256',
  'SFCP_VSCODE_LATEST_VERSION',
  'SFCP_VSCODE_DOWNLOAD_URL',
  'SFCP_VSCODE_SHA256',
  'SFCP_MANIFEST_RATE_LIMIT_MAX',
  'SFCP_MANIFEST_RATE_LIMIT_WINDOW_MS',
  'SFCP_DOWNLOAD_RATE_LIMIT_MAX',
  'SFCP_DOWNLOAD_RATE_LIMIT_WINDOW_MS',
  'SFCP_AUTH_RATE_LIMIT_MAX',
  'SFCP_AUTH_RATE_LIMIT_WINDOW_MS',
  'PUBLIC_BACKEND_URL',
  'PAYLOAD_PUBLIC_SERVER_URL',
  'NEXT_PUBLIC_SERVER_URL',
] as const

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

let tempDir: string | null = null

beforeEach(() => {
  resetRateLimitStore()
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(async () => {
  resetRateLimitStore()
  for (const key of ENV_KEYS) {
    const previous = savedEnv[key]
    if (previous === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = previous
    }
  }

  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('SemVer and SHA-256 helpers', () => {
  it('normalizes optional v prefix and compares SemVer numerically', () => {
    expect(normalizeVersion('v1.10.0')).toBe('1.10.0')
    expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareSemver('2.0.0', '1.99.99')).toBeGreaterThan(0)
    expect(compareSemver('1.2.0', '1.2.0-rc.1')).toBeGreaterThan(0)
    expect(compareSemver('1.2.0-rc.1', '1.2.0-beta.2')).toBeGreaterThan(0)
    expect(compareSemver('1.2.0-alpha.10', '1.2.0-alpha.2')).toBeGreaterThan(0)
    expect(compareSemver('v1.2.0', '1.2.0')).toBe(0)
  })

  it('computes identical SHA-256 digests from Buffer and file path', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'sfcp-sha-test-'))
    const payload = Buffer.from('sfc-pro-binary-payload-v1.2.3')
    const filePath = path.join(tempDir, 'artifact.bin')
    await writeFile(filePath, payload)

    const expected = sha256Hex(payload)
    expect(computeBufferSha256(payload)).toBe(expected)
    await expect(computeFileSha256(filePath)).resolves.toBe(expected)
  })
})

describe('Releases collection hooks & validation', () => {
  it('configures upload storage without requiring a file on create and disables pasteURL', () => {
    expect(Releases.slug).toBe('releases')
    expect(typeof Releases.upload).toBe('object')
    if (typeof Releases.upload === 'object') {
      expect(Releases.upload.filesRequiredOnCreate).toBe(false)
      expect(Releases.upload.pasteURL).toBe(false)
    }
  })

  it('automatically calculates sha256 from uploaded file buffer when omitted', async () => {
    const fileBytes = Buffer.from('linux-elf-binary-content')
    const result = (await prepareReleaseData({
      collection: Releases as never,
      context: {},
      data: {
        version: 'v1.4.0',
        target: 'linux-x86_64',
        filename: 'sfc-pro-1.4.0-linux-x86_64.tar.gz',
      },
      operation: 'create',
      req: {
        file: {
          name: 'sfc-pro-1.4.0-linux-x86_64.tar.gz',
          data: fileBytes,
          mimetype: 'application/gzip',
          size: fileBytes.length,
        },
      } as never,
    })) as Record<string, unknown>

    expect(result.product).toBe('sfc-pro')
    expect(result.version).toBe('1.4.0')
    expect(result.sha256).toBe(sha256Hex(fileBytes))
    expect(result.releaseLabel).toBe('sfc-pro v1.4.0 (linux-x86_64)')
    expect(typeof result.publishedAt).toBe('string')
  })

  it('automatically calculates sha256 from tempFilePath when temp files are enabled', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'sfcp-temp-upload-'))
    const fileBytes = Buffer.from('vsix-package-zip-bytes')
    const tempFilePath = path.join(tempDir, 'upload.tmp')
    await writeFile(tempFilePath, fileBytes)

    const result = (await prepareReleaseData({
      collection: Releases as never,
      context: {},
      data: {
        target: 'vscode',
        version: '0.7.0',
        filename: 'sfcp-vscode-0.7.0.vsix',
      },
      operation: 'create',
      req: {
        file: {
          name: 'sfcp-vscode-0.7.0.vsix',
          data: Buffer.alloc(0),
          tempFilePath,
          mimetype: 'application/vsix',
          size: fileBytes.length,
        },
      } as never,
    })) as Record<string, unknown>

    expect(result.product).toBe('sfcp-vscode')
    expect(result.target).toBe('vscode')
    expect(result.sha256).toBe(sha256Hex(fileBytes))
  })

  it('preserves explicitly provided sha256 on create and recomputes on file replacement update', async () => {
    const manualSha = 'A'.repeat(64)
    const initialBytes = Buffer.from('old-binary')
    const created = (await prepareReleaseData({
      collection: Releases as never,
      context: {},
      data: {
        product: 'sfc-pro',
        version: '1.0.0',
        target: 'windows-x86_64',
        sha256: manualSha,
        filename: 'sfc-pro-1.0.0-windows-x86_64.zip',
      },
      operation: 'create',
      req: {
        file: {
          name: 'sfc-pro-1.0.0-windows-x86_64.zip',
          data: initialBytes,
          mimetype: 'application/zip',
          size: initialBytes.length,
        },
      } as never,
    })) as Record<string, unknown>

    expect(created.sha256).toBe('a'.repeat(64))

    // Admin replaces the uploaded file without clearing old sha256 in the form
    const replacementBytes = Buffer.from('new-rebuilt-binary')
    const updated = (await prepareReleaseData({
      collection: Releases as never,
      context: {},
      data: {
        product: 'sfc-pro',
        version: '1.0.0',
        target: 'windows-x86_64',
        sha256: 'a'.repeat(64),
        filename: 'sfc-pro-1.0.0-windows-x86_64.zip',
      },
      originalDoc: {
        product: 'sfc-pro',
        version: '1.0.0',
        target: 'windows-x86_64',
        sha256: 'a'.repeat(64),
        filename: 'sfc-pro-1.0.0-windows-x86_64.zip',
      },
      operation: 'update',
      req: {
        file: {
          name: 'sfc-pro-1.0.0-windows-x86_64.zip',
          data: replacementBytes,
          mimetype: 'application/zip',
          size: replacementBytes.length,
        },
      } as never,
    })) as Record<string, unknown>

    expect(updated.sha256).toBe(sha256Hex(replacementBytes))
  })

  it('maps custom OS/arch target slug cleanly and rejects unsafe/mismatched uploads', async () => {
    const customResult = (await prepareReleaseData({
      collection: Releases as never,
      context: {},
      data: {
        product: 'sfc-pro',
        version: '1.3.0',
        target: 'freebsd-x86_64',
        downloadUrl: 'https://downloads.example.com/sfc-pro-1.3.0-freebsd.tar.gz',
      },
      operation: 'create',
      req: {} as never,
    })) as Record<string, unknown>

    expect(customResult.target).toBe('custom')
    expect(customResult.customTarget).toBe('freebsd-x86_64')

    // Reject non-.vsix for sfcp-vscode
    await expect(
      prepareReleaseData({
        collection: Releases as never,
        context: {},
        data: {
          product: 'sfcp-vscode',
          target: 'vscode',
          version: '1.0.0',
          filename: 'not-a-vsix.zip',
        },
        operation: 'create',
        req: {
          file: { name: 'not-a-vsix.zip', data: Buffer.from('zip'), mimetype: 'application/zip', size: 3 },
        } as never,
      }),
    ).rejects.toThrow(/\.vsix/i)

    // Reject HTML upload
    await expect(
      prepareReleaseData({
        collection: Releases as never,
        context: {},
        data: {
          product: 'sfc-pro',
          target: 'linux-x86_64',
          version: '1.0.0',
          filename: 'evil.html',
        },
        operation: 'create',
        req: {
          file: { name: 'evil.html', data: Buffer.from('<script>'), mimetype: 'text/html', size: 8 },
        } as never,
      }),
    ).rejects.toThrow(/unsafe/i)

    // Reject missing both file and downloadUrl
    await expect(
      prepareReleaseData({
        collection: Releases as never,
        context: {},
        data: {
          product: 'sfc-pro',
          target: 'linux-x86_64',
          version: '1.0.0',
        },
        operation: 'create',
        req: {} as never,
      }),
    ).rejects.toThrow(/upload a release file or provide an external download URL/i)

    // Reject credentials in external downloadUrl
    await expect(
      prepareReleaseData({
        collection: Releases as never,
        context: {},
        data: {
          product: 'sfc-pro',
          target: 'linux-x86_64',
          version: '1.0.0',
          downloadUrl: 'https://secretuser:secretpass@example.com/file.tar.gz',
        },
        operation: 'create',
        req: {} as never,
      }),
    ).rejects.toThrow(/valid http\(s\) URL/i)
  })

  it('clears older pinned version automatically when a higher SemVer release is created', async () => {
    const find = vi.fn().mockResolvedValue({
      docs: [
        { id: 1, product: 'sfc-pro', version: '1.1.0', target: 'linux-x86_64', isCurrent: true, status: 'published' },
        { id: 2, product: 'sfc-pro', version: '1.1.0', target: 'windows-x86_64', isCurrent: true, status: 'published' },
      ],
    })
    const update = vi.fn().mockResolvedValue({})
    const uploadedFile = { name: 'sfc-pro-1.2.0-linux-x86_64.tar.gz', data: Buffer.from('bin'), mimetype: 'application/gzip', size: 3 }
    const req = {
      context: {},
      file: uploadedFile,
      payload: { find, update },
    }

    await syncCurrentReleaseVersion({
      collection: Releases as never,
      context: {},
      data: {},
      doc: {
        id: 3,
        product: 'sfc-pro',
        version: '1.2.0',
        target: 'linux-x86_64',
        channel: 'stable',
        status: 'published',
        isCurrent: false,
      },
      operation: 'create',
      previousDoc: {} as never,
      req: req as never,
    })

    expect(update).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'releases',
        id: 1,
        data: { isCurrent: false },
        context: expect.objectContaining({ skipReleasePinSync: true }),
      }),
    )
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'releases',
        id: 2,
        data: { isCurrent: false },
        context: expect.objectContaining({ skipReleasePinSync: true }),
      }),
    )
    // Original req.file must remain intact for Payload's post-hook temp file cleanup
    expect(req.file).toBe(uploadedFile)
  })
})

describe('Dynamic manifest endpoints (GET /api/sfcp/update.json & /api/sfcp/vscode-update.json)', () => {
  const linuxSha10 = sha256Hex('sfc-pro-1.10.0-linux')
  const winSha10 = sha256Hex('sfc-pro-1.10.0-windows')
  const macSha10 = sha256Hex('sfc-pro-1.10.0-macos')
  const linuxSha9 = sha256Hex('sfc-pro-1.9.0-linux')
  const vsixShaOld = sha256Hex('vsix-0.9.0')
  const vsixShaNew = sha256Hex('vsix-0.10.0')

  it('dynamically generates multi-platform sfc-pro manifest and selects highest SemVer automatically', async () => {
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://heysh1n.com.tr'

    const docs: ReleaseDocument[] = [
      {
        id: 1,
        product: 'sfc-pro',
        version: '1.9.0',
        target: 'linux-x86_64',
        channel: 'stable',
        status: 'published',
        filename: 'sfc-pro-1.9.0-linux-x86_64.tar.gz',
        filesize: 1000,
        sha256: linuxSha9,
        publishedAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
      },
      {
        id: 2,
        product: 'sfc-pro',
        version: '1.10.0',
        target: 'linux-x86_64',
        channel: 'stable',
        status: 'published',
        filename: 'sfc-pro-1.10.0-linux-x86_64.tar.gz',
        filesize: 2048,
        sha256: linuxSha10,
        notes: 'Faster indexing and Windows support',
        publishedAt: '2026-11-20T12:00:00.000Z',
        updatedAt: '2026-11-20T12:00:00.000Z',
      },
      {
        id: 3,
        product: 'sfc-pro',
        version: '1.10.0',
        target: 'windows-x86_64',
        channel: 'stable',
        status: 'published',
        filename: 'sfc-pro-1.10.0-windows-x86_64.zip',
        filesize: 2560,
        sha256: winSha10,
        publishedAt: '2026-11-20T12:05:00.000Z',
        updatedAt: '2026-11-20T12:05:00.000Z',
      },
      {
        id: 4,
        product: 'sfc-pro',
        version: '1.10.0',
        target: 'macos-arm64',
        channel: 'stable',
        status: 'published',
        filename: 'sfc-pro-1.10.0-macos-arm64.tar.gz',
        filesize: 2300,
        sha256: macSha10,
        publishedAt: '2026-11-20T12:06:00.000Z',
        updatedAt: '2026-11-20T12:06:00.000Z',
      },
      // Draft newer version must be excluded
      {
        id: 5,
        product: 'sfc-pro',
        version: '2.0.0',
        target: 'linux-x86_64',
        channel: 'stable',
        status: 'draft',
        filename: 'sfc-pro-2.0.0-linux-x86_64.tar.gz',
        filesize: 3000,
        sha256: sha256Hex('draft'),
      },
    ]

    const req = new Request('https://heysh1n.com.tr/api/sfcp/update.json', {
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        host: 'evil.attacker.example',
        'x-real-ip': '203.0.113.10',
      },
    })
    ;(req as any).payload = {
      find: vi.fn().mockResolvedValue({ docs }),
    }

    const response = await updateManifestEndpoint.handler(req as never)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('location')).toBeNull()

    const body = await response.json()
    expect(body).toEqual({
      product: 'sfc-pro',
      version: '1.10.0',
      latest_version: '1.10.0',
      channel: 'stable',
      published_at: '2026-11-20T12:06:00.000Z',
      notes: 'Faster indexing and Windows support',
      download_url: 'https://heysh1n.com.tr/api/sfcp/downloads/sfc-pro-1.10.0-linux-x86_64.tar.gz',
      downloadUrl: 'https://heysh1n.com.tr/api/sfcp/downloads/sfc-pro-1.10.0-linux-x86_64.tar.gz',
      sha256: linuxSha10,
      platforms: {
        'linux-x86_64': {
          download_url:
            'https://heysh1n.com.tr/api/sfcp/downloads/sfc-pro-1.10.0-linux-x86_64.tar.gz',
          sha256: linuxSha10,
          filename: 'sfc-pro-1.10.0-linux-x86_64.tar.gz',
          size: 2048,
        },
        'macos-arm64': {
          download_url: 'https://heysh1n.com.tr/api/sfcp/downloads/sfc-pro-1.10.0-macos-arm64.tar.gz',
          sha256: macSha10,
          filename: 'sfc-pro-1.10.0-macos-arm64.tar.gz',
          size: 2300,
        },
        'windows-x86_64': {
          download_url: 'https://heysh1n.com.tr/api/sfcp/downloads/sfc-pro-1.10.0-windows-x86_64.zip',
          sha256: winSha10,
          filename: 'sfc-pro-1.10.0-windows-x86_64.zip',
          size: 2560,
        },
      },
    })
  })

  it('supports platform-specific top-level fallback query and pinned rollback version', () => {
    const docs: ReleaseDocument[] = [
      {
        id: 10,
        product: 'sfc-pro',
        version: '1.1.0',
        target: 'linux-x86_64',
        channel: 'stable',
        status: 'published',
        isCurrent: true,
        filename: 'sfc-pro-1.1.0-linux-x86_64.tar.gz',
        sha256: linuxSha9,
      },
      {
        id: 11,
        product: 'sfc-pro',
        version: '1.1.0',
        target: 'windows-x86_64',
        channel: 'stable',
        status: 'published',
        isCurrent: false,
        filename: 'sfc-pro-1.1.0-windows-x86_64.zip',
        sha256: winSha10,
      },
      {
        id: 12,
        product: 'sfc-pro',
        version: '1.2.0',
        target: 'linux-x86_64',
        channel: 'stable',
        status: 'published',
        isCurrent: false,
        filename: 'sfc-pro-1.2.0-linux-x86_64.tar.gz',
        sha256: linuxSha10,
      },
    ]

    const manifest = buildSfcProManifest(docs, {
      baseUrl: 'https://heysh1n.com.tr',
      requestedPlatform: 'windows-x86_64',
    })

    // Pinned 1.1.0 wins over 1.2.0 and includes ALL platforms belonging to 1.1.0
    expect(manifest.version).toBe('1.1.0')
    expect(manifest.latest_version).toBe('1.1.0')
    expect(Object.keys(manifest.platforms)).toEqual(['linux-x86_64', 'windows-x86_64'])
    expect(manifest.download_url).toBe(
      'https://heysh1n.com.tr/api/sfcp/downloads/sfc-pro-1.1.0-windows-x86_64.zip',
    )
    expect(manifest.sha256).toBe(winSha10)
  })

  it('dynamically generates sfcp-vscode manifest pointing to latest .vsix package', async () => {
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://heysh1n.com.tr'

    const docs: ReleaseDocument[] = [
      {
        id: 20,
        product: 'sfcp-vscode',
        version: '0.9.0',
        target: 'vscode',
        channel: 'stable',
        status: 'published',
        filename: 'sfcp-vscode-0.9.0.vsix',
        filesize: 512000,
        sha256: vsixShaOld,
        publishedAt: '2026-10-10T10:00:00.000Z',
      },
      {
        id: 21,
        product: 'sfcp-vscode',
        version: '0.10.0',
        target: 'vscode',
        channel: 'stable',
        status: 'published',
        filename: 'sfcp-vscode-0.10.0.vsix',
        filesize: 640000,
        sha256: vsixShaNew,
        notes: 'VS Code 1.96 compatibility',
        publishedAt: '2026-11-22T15:00:00.000Z',
      },
    ]

    const req = new Request('https://heysh1n.com.tr/api/sfcp/vscode-update.json', {
      method: 'GET',
      headers: { 'x-real-ip': '203.0.113.11' },
    })
    ;(req as any).payload = {
      find: vi.fn().mockResolvedValue({ docs }),
    }

    const response = await vscodeUpdateManifestEndpoint.handler(req as never)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')

    const body = await response.json()
    expect(body).toEqual({
      product: 'sfcp-vscode',
      version: '0.10.0',
      latest_version: '0.10.0',
      channel: 'stable',
      published_at: '2026-11-22T15:00:00.000Z',
      notes: 'VS Code 1.96 compatibility',
      download_url: 'https://heysh1n.com.tr/api/sfcp/downloads/sfcp-vscode-0.10.0.vsix',
      downloadUrl: 'https://heysh1n.com.tr/api/sfcp/downloads/sfcp-vscode-0.10.0.vsix',
      sha256: vsixShaNew,
      filename: 'sfcp-vscode-0.10.0.vsix',
      size: 640000,
    })
  })

  it('falls back safely when no releases exist in database and hides DB errors/secrets', async () => {
    const emptyManifest = buildVscodeManifest([], {
      baseUrl: 'https://heysh1n.com.tr',
      envFallback: {
        version: '0.1.0',
        downloadUrl: 'https://cdn.heysh1n.com.tr/sfcp-vscode-0.1.0.vsix',
        sha256: vsixShaOld,
      },
    })
    expect(emptyManifest.version).toBe('0.1.0')
    expect(emptyManifest.download_url).toBe('https://cdn.heysh1n.com.tr/sfcp-vscode-0.1.0.vsix')
    expect(emptyManifest.sha256).toBe(vsixShaOld)

    // Simulate DB failure containing sensitive connection string & server path
    const logError = vi.fn()
    const dbError = Object.assign(
      new Error(
        'connect ECONNREFUSED postgres://admin:supersecret@db.internal:5432/prod at /var/www/secret/backend',
      ),
      { code: 'ECONNREFUSED' },
    )
    const req = new Request('https://heysh1n.com.tr/api/sfcp/update.json', {
      method: 'GET',
      headers: { 'x-real-ip': '203.0.113.12' },
    })
    ;(req as any).payload = {
      find: vi.fn().mockRejectedValue(dbError),
      logger: { error: logError },
    }

    const response = await updateManifestEndpoint.handler(req as never)
    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toContain('application/json')

    const text = await response.text()
    expect(text).not.toContain('supersecret')
    expect(text).not.toContain('/var/www')
    expect(text).not.toContain('postgres://')
    expect(JSON.parse(text)).toEqual({ error: 'Unable to load update manifest.' })

    // Verify logger also received sanitized error metadata without secrets or paths
    expect(logError).toHaveBeenCalledTimes(1)
    const loggedPayload = JSON.stringify(logError.mock.calls[0])
    expect(loggedPayload).not.toContain('supersecret')
    expect(loggedPayload).not.toContain('/var/www')
    expect(loggedPayload).not.toContain('postgres://')
  })
})

describe('Release file download endpoint (/api/sfcp/downloads/:filename)', () => {
  it('streams published release artifacts with exact bytes, checksum headers, and HEAD support', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'sfcp-releases-dir-'))
    process.env.SFCP_RELEASES_DIR = tempDir

    const vsixContent = Buffer.from('PK\x03\x04fake-vsix-zip-content-for-testing')
    const vsixSha = sha256Hex(vsixContent)
    const filename = 'sfcp-vscode-1.2.3.vsix'
    await writeFile(path.join(tempDir, filename), vsixContent)

    const find = vi.fn().mockResolvedValue({
      docs: [
        {
          id: 100,
          product: 'sfcp-vscode',
          version: '1.2.3',
          target: 'vscode',
          status: 'published',
          filename,
          filesize: vsixContent.length,
          sha256: vsixSha,
        },
      ],
    })

    const getReq = new Request(`https://heysh1n.com.tr/api/sfcp/downloads/${filename}`, {
      method: 'GET',
      headers: { 'x-real-ip': '198.51.100.1' },
    })
    ;(getReq as any).routeParams = { filename }
    ;(getReq as any).payload = { find }

    const getRes = await releaseDownloadEndpoint.handler(getReq as never)
    expect(getRes.status).toBe(200)
    expect(getRes.headers.get('content-type')).toBe('application/vsix')
    expect(getRes.headers.get('content-length')).toBe(String(vsixContent.length))
    expect(getRes.headers.get('content-disposition')).toBe(
      'attachment; filename="sfcp-vscode-1.2.3.vsix"',
    )
    expect(getRes.headers.get('x-content-type-options')).toBe('nosniff')
    expect(getRes.headers.get('cache-control')).toContain('no-transform')
    expect(getRes.headers.get('x-checksum-sha256')).toBe(vsixSha)
    expect(getRes.headers.get('etag')).toBe(`"sha256-${vsixSha}"`)

    const downloaded = Buffer.from(await getRes.arrayBuffer())
    expect(downloaded.equals(vsixContent)).toBe(true)
    expect(sha256Hex(downloaded)).toBe(vsixSha)

    // HEAD request returns headers with empty body
    const headReq = new Request(`https://heysh1n.com.tr/api/sfcp/downloads/${filename}`, {
      method: 'HEAD',
      headers: { 'x-real-ip': '198.51.100.1' },
    })
    ;(headReq as any).routeParams = { filename }
    ;(headReq as any).payload = { find }

    const headRes = await releaseDownloadHeadEndpoint.handler(headReq as never)
    expect(headRes.status).toBe(200)
    expect(headRes.headers.get('content-length')).toBe(String(vsixContent.length))
    expect(await headRes.text()).toBe('')
  })

  it('blocks path traversal and unpublished/missing files without leaking internal server paths', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'sfcp-releases-sec-'))
    process.env.SFCP_RELEASES_DIR = tempDir

    const find = vi.fn().mockResolvedValue({ docs: [] })

    for (const badName of ['../.env', '../../etc/passwd', 'subdir/file.bin', '.hidden']) {
      const req = new Request('https://heysh1n.com.tr/api/sfcp/downloads/invalid', {
        method: 'GET',
        headers: { 'x-real-ip': '198.51.100.2' },
      })
      ;(req as any).routeParams = { filename: badName }
      ;(req as any).payload = { find }

      const res = await releaseDownloadEndpoint.handler(req as never)
      expect(res.status).toBe(400)
      expect(res.headers.get('content-type')).toContain('application/json')
      const bodyText = await res.text()
      expect(bodyText).not.toContain(tempDir)
      expect(JSON.parse(bodyText)).toEqual({ error: 'Invalid release filename.' })
    }
    expect(find).not.toHaveBeenCalled()

    // File exists in DB as published, but missing on disk -> clean 404 JSON without leaking tempDir
    const missingReq = new Request('https://heysh1n.com.tr/api/sfcp/downloads/missing.tar.gz', {
      method: 'GET',
      headers: { 'x-real-ip': '198.51.100.3' },
    })
    ;(missingReq as any).routeParams = { filename: 'missing.tar.gz' }
    ;(missingReq as any).payload = {
      find: vi.fn().mockResolvedValue({
        docs: [{ id: 1, status: 'published', filename: 'missing.tar.gz' }],
      }),
    }

    const missingRes = await releaseDownloadEndpoint.handler(missingReq as never)
    expect(missingRes.status).toBe(404)
    expect(missingRes.headers.get('content-type')).toContain('application/json')
    const missingText = await missingRes.text()
    expect(missingText).not.toContain(tempDir)
    expect(JSON.parse(missingText)).toEqual({ error: 'Release file not found.' })
  })
})

describe('Rate limiting on SFCP endpoints', () => {
  it('enforces per-IP rate limits on manifest, download, and license endpoints with 429 JSON', async () => {
    process.env.SFCP_MANIFEST_RATE_LIMIT_MAX = '2'
    process.env.SFCP_MANIFEST_RATE_LIMIT_WINDOW_MS = '60000'
    process.env.SFCP_DOWNLOAD_RATE_LIMIT_MAX = '1'
    process.env.SFCP_AUTH_RATE_LIMIT_MAX = '1'

    const makeManifestReq = (ip: string) => {
      const req = new Request('https://heysh1n.com.tr/api/sfcp/update.json', {
        method: 'GET',
        headers: { 'x-real-ip': ip },
      })
      ;(req as any).payload = { find: vi.fn().mockResolvedValue({ docs: [] }) }
      return req
    }

    // Client A allowed twice, blocked on 3rd
    expect((await updateManifestEndpoint.handler(makeManifestReq('192.0.2.10') as never)).status).toBe(200)
    expect((await updateManifestEndpoint.handler(makeManifestReq('192.0.2.10') as never)).status).toBe(200)
    const limited = await updateManifestEndpoint.handler(makeManifestReq('192.0.2.10') as never)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('content-type')).toContain('application/json')
    expect(limited.headers.get('retry-after')).toBeTruthy()
    expect(limited.headers.get('x-ratelimit-remaining')).toBe('0')
    expect(await limited.json()).toEqual({ error: 'Too many requests. Please try again later.' })

    // Client B still allowed independently
    expect((await updateManifestEndpoint.handler(makeManifestReq('192.0.2.11') as never)).status).toBe(200)

    // Download endpoint rate limit
    const makeDownloadReq = (ip: string) => {
      const req = new Request('https://heysh1n.com.tr/api/sfcp/downloads/none.tar.gz', {
        method: 'GET',
        headers: { 'x-real-ip': ip },
      })
      ;(req as any).routeParams = { filename: 'none.tar.gz' }
      ;(req as any).payload = { find: vi.fn().mockResolvedValue({ docs: [] }) }
      return req
    }
    expect((await releaseDownloadEndpoint.handler(makeDownloadReq('192.0.2.20') as never)).status).toBe(404)
    expect((await releaseDownloadEndpoint.handler(makeDownloadReq('192.0.2.20') as never)).status).toBe(429)

    // License validate endpoint rate limit
    const makeValidateReq = (ip: string) => {
      const req = new Request('https://heysh1n.com.tr/api/v1/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sfcp-agent': 'secure-client-v1', 'x-real-ip': ip },
        body: JSON.stringify({}),
      })
      ;(req as any).payload = { find: vi.fn().mockResolvedValue({ docs: [] }) }
      return req
    }
    expect((await validateLicenseEndpoint.handler(makeValidateReq('192.0.2.30') as never)).status).toBe(400)
    expect((await validateLicenseEndpoint.handler(makeValidateReq('192.0.2.30') as never)).status).toBe(429)
  })
})

describe('End-to-end release upload -> manifest switch -> verified download flow & middleware JSON guard', () => {
  it('automatically updates manifest and serves matching sha256 bytes after uploading a newer release', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'sfcp-e2e-flow-'))
    process.env.SFCP_RELEASES_DIR = tempDir
    process.env.NEXT_PUBLIC_SERVER_URL = 'https://heysh1n.com.tr'

    const store: ReleaseDocument[] = []
    let nextId = 1

    const uploadRelease = async (params: {
      product: 'sfc-pro' | 'sfcp-vscode'
      version: string
      target: ReleaseDocument['target']
      filename: string
      bytes: Buffer
    }) => {
      await writeFile(path.join(tempDir!, params.filename), params.bytes)
      const prepared = (await prepareReleaseData({
        collection: Releases as never,
        context: {},
        data: {
          product: params.product,
          version: params.version,
          target: params.target,
          status: 'published',
          channel: 'stable',
          filename: params.filename,
          filesize: params.bytes.length,
        },
        operation: 'create',
        req: {
          file: {
            name: params.filename,
            data: params.bytes,
            mimetype: 'application/octet-stream',
            size: params.bytes.length,
          },
        } as never,
      })) as unknown as ReleaseDocument

      const created: ReleaseDocument = {
        ...prepared,
        id: nextId++,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      store.push(created)
      return created
    }

    const mockPayload = {
      find: vi.fn().mockImplementation(async ({ where }: any) => {
        const filters = Array.isArray(where?.and) ? where.and : []
        const docs = store.filter((doc) =>
          filters.every((cond: Record<string, { equals: unknown }>) => {
            const [field, op] = Object.entries(cond)[0]
            return (doc as unknown as Record<string, unknown>)[field] === op.equals
          }),
        )
        return { docs }
      }),
    }

    // 1. Upload v1.0.0 for Linux & Windows
    await uploadRelease({
      product: 'sfc-pro',
      version: '1.0.0',
      target: 'linux-x86_64',
      filename: 'sfc-pro-1.0.0-linux-x86_64.tar.gz',
      bytes: Buffer.from('linux-v1.0.0'),
    })
    await uploadRelease({
      product: 'sfc-pro',
      version: '1.0.0',
      target: 'windows-x86_64',
      filename: 'sfc-pro-1.0.0-windows-x86_64.zip',
      bytes: Buffer.from('windows-v1.0.0'),
    })

    const req1 = new Request('https://heysh1n.com.tr/api/sfcp/update.json', {
      headers: { 'x-real-ip': '198.51.100.50' },
    })
    ;(req1 as any).payload = mockPayload
    const manifest1 = await (await updateManifestEndpoint.handler(req1 as never)).json()
    expect(manifest1.latest_version).toBe('1.0.0')
    expect(Object.keys(manifest1.platforms)).toEqual(['linux-x86_64', 'windows-x86_64'])

    // 2. Upload v1.1.0 for Linux & Windows -> manifest switches automatically with auto-calculated sha256
    const winBytes11 = Buffer.from('windows-v1.1.0-new-binary')
    await uploadRelease({
      product: 'sfc-pro',
      version: '1.1.0',
      target: 'linux-x86_64',
      filename: 'sfc-pro-1.1.0-linux-x86_64.tar.gz',
      bytes: Buffer.from('linux-v1.1.0-new-binary'),
    })
    await uploadRelease({
      product: 'sfc-pro',
      version: '1.1.0',
      target: 'windows-x86_64',
      filename: 'sfc-pro-1.1.0-windows-x86_64.zip',
      bytes: winBytes11,
    })

    const req2 = new Request('https://heysh1n.com.tr/api/sfcp/update.json', {
      headers: { 'x-real-ip': '198.51.100.50' },
    })
    ;(req2 as any).payload = mockPayload
    const manifest2 = await (await updateManifestEndpoint.handler(req2 as never)).json()
    expect(manifest2.latest_version).toBe('1.1.0')
    expect(manifest2.version).toBe('1.1.0')
    expect(manifest2.platforms['windows-x86_64'].sha256).toBe(sha256Hex(winBytes11))

    // 3. Follow download_url from manifest and verify downloaded bytes match manifest sha256
    const winDownloadUrl: string = manifest2.platforms['windows-x86_64'].download_url
    const downloadReq = new Request(winDownloadUrl, {
      method: 'GET',
      headers: { 'x-real-ip': '198.51.100.50' },
    })
    ;(downloadReq as any).payload = mockPayload
    const downloadRes = await releaseDownloadEndpoint.handler(downloadReq as never)
    expect(downloadRes.status).toBe(200)
    const downloadedBuf = Buffer.from(await downloadRes.arrayBuffer())
    expect(sha256Hex(downloadedBuf)).toBe(manifest2.platforms['windows-x86_64'].sha256)
  })

  it('returns strict JSON 403 for disallowed hosts on /api/* in production middleware without HTML redirect', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const allowedReq = new NextRequest('https://heysh1n.com.tr/api/sfcp/update.json', {
        headers: { host: 'heysh1n.com.tr' },
      })
      const allowedRes = middleware(allowedReq)
      expect(allowedRes.status).toBe(200)
      expect(allowedRes.headers.get('location')).toBeNull()

      const blockedReq = new NextRequest('https://evil.onrender.com/api/sfcp/update.json', {
        headers: { host: 'evil.onrender.com' },
      })
      const blockedRes = middleware(blockedReq)
      expect(blockedRes.status).toBe(403)
      expect(blockedRes.headers.get('content-type')).toContain('application/json')
      expect(await blockedRes.json()).toEqual({ error: 'Direct access forbidden' })
    } finally {
      if (prevNodeEnv === undefined) {
        vi.unstubAllEnvs()
      } else {
        vi.stubEnv('NODE_ENV', prevNodeEnv)
      }
    }
  })
})
