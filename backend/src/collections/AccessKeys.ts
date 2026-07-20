import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import type { ProjectDocument } from './Projects'
import { isOwner } from './Users'

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
    read: isOwner,
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
    group: 'SFCP',
    defaultColumns: ['keyName', 'license_key', 'status', 'hwid', 'lastValidatedAt'],
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
      type: 'text',
      required: true,
    },
    {
      name: 'license_key',
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
      type: 'select',
      options: accessKeyStatusOptions,
      defaultValue: 'active',
      required: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'hwid',
      type: 'text',
      admin: {
        description: 'Bound automatically on first successful validation.',
        position: 'sidebar',
      },
    },
    {
      name: 'expiresAt',
      type: 'date',
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
        position: 'sidebar',
      },
    },
    {
      name: 'lastValidatedAt',
      type: 'date',
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
        readOnly: true,
        position: 'sidebar',
      },
    },
    {
      name: 'associatedProject',
      type: 'relationship',
      relationTo: 'projects',
      admin: {
        position: 'sidebar',
      },
    },
  ],
}
