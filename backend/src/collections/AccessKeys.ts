import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import type { ProjectDocument } from './Projects'
import { isAdminOrOwner, isOwner } from './Users'

export type AccessKeyStatus = 'active' | 'inactive' | 'revoked'

export interface AccessKeyDocument {
  id: number | string
  keyName: string
  license_key: string
  status?: AccessKeyStatus | null
  hwid?: string | null
  expiresAt?: string | null
  lastValidatedAt?: string | null
  associatedProject?: number | string | ProjectDocument | null
}

const accessKeyStatusOptions = [
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
  { label: 'Revoked', value: 'revoked' },
] satisfies Array<{ label: string; value: AccessKeyStatus }>

/**
 * Generates a deterministic license key in the format: SFCP-{YEAR}-{NAME}-{DDMM}
 *
 * - {YEAR}  — current year (e.g. 2026)
 * - {NAME}  — keyName stripped to latin alphanumerics, uppercased, truncated to 6 chars.
 *             Falls back to "USER" if empty after sanitization.
 * - {DDMM}  — current day + month, zero-padded.
 */
const generateLicenseKey = (keyName: string | undefined | null): string => {
  const now = new Date()
  const year = now.getFullYear()

  const sanitized = (keyName ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 6)

  const namePart = sanitized.length > 0 ? sanitized : 'USER'

  const day = String(now.getDate()).padStart(2, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')

  return `SFCP-${year}-${namePart}-${day}${month}`
}

const autoGenerateLicenseKey: CollectionBeforeChangeHook = ({ data, operation }) => {
  if (operation === 'create' && (!data?.license_key || data.license_key.trim().length === 0)) {
    return {
      ...data,
      license_key: generateLicenseKey(data?.keyName as string | undefined),
    }
  }

  return data
}

export const AccessKeys: CollectionConfig = {
  slug: 'access-keys',
  access: {
    read: isAdminOrOwner,
    create: isOwner,
    update: isOwner,
    delete: isOwner,
  },
  labels: {
    singular: 'Access Key',
    plural: 'Access Keys',
  },
  admin: {
    useAsTitle: 'keyName',
    group: 'SFC Pro Management',
    defaultColumns: ['keyName', 'license_key', 'hwid', 'status', 'lastValidatedAt', 'createdAt'],
  },
  typescript: {
    interface: 'AccessKey',
  },
  hooks: {
    beforeChange: [autoGenerateLicenseKey],
  },
  fields: [
    {
      name: 'keyName',
      label: 'Key Name',
      type: 'text',
      required: true,
      admin: {
        description:
          'Identifier or owner name for this key (used to generate the deterministic SFCP license format).',
      },
    },
    {
      name: 'license_key',
      label: 'License Key',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        description:
          'License key used by SFCP clients. Leave blank on creation to auto-generate (SFCP-YEAR-NAME-DDMM).',
      },
    },
    {
      name: 'status',
      label: 'Status',
      type: 'select',
      options: accessKeyStatusOptions,
      defaultValue: 'active',
      required: true,
      admin: {
        description:
          'Current activation status of the license key. Revoked keys immediately block client access.',
        position: 'sidebar',
      },
    },
    {
      name: 'hwid',
      label: 'HWID',
      type: 'text',
      admin: {
        description:
          'Hardware ID fingerprint bound automatically on the first successful client validation. Clear to reset binding.',
        position: 'sidebar',
      },
    },
    {
      name: 'expiresAt',
      label: 'Expires At',
      type: 'date',
      admin: {
        description: 'Optional expiration date and time. Leave empty for a lifetime license.',
        date: {
          pickerAppearance: 'dayAndTime',
        },
        position: 'sidebar',
      },
    },
    {
      name: 'lastValidatedAt',
      label: 'Last Validated At',
      type: 'date',
      admin: {
        description:
          'Timestamp of the most recent successful validation request from an SFCP client.',
        date: {
          pickerAppearance: 'dayAndTime',
        },
        readOnly: true,
        position: 'sidebar',
      },
    },
    {
      name: 'associatedProject',
      label: 'Associated Project',
      type: 'relationship',
      relationTo: 'projects',
      admin: {
        description: 'Project associated with this license key.',
        position: 'sidebar',
      },
    },
  ],
}
