import type { Access, CollectionConfig } from 'payload'

export type AccessKeyStatus = 'active' | 'revoked' | 'expired'

export interface AccessKeyDocument {
  id: number | string
  key: string
  hwid?: string | null
  status: AccessKeyStatus
  expiresAt?: string | null
  owner?: string | null
}

const isAdmin: Access = ({ req: { user } }) => {
  if (!user) return false

  const roleUser = user as { role?: unknown; roles?: unknown }

  if (Array.isArray(roleUser.roles)) {
    return roleUser.roles.includes('admin') || roleUser.roles.includes('owner')
  }

  if (typeof roleUser.role === 'string') {
    return roleUser.role === 'admin' || roleUser.role === 'owner'
  }

  return true
}

export const AccessKeys: CollectionConfig = {
  slug: 'access-keys',
  admin: {
    useAsTitle: 'key',
    group: 'SFCP',
    defaultColumns: ['key', 'status', 'hwid', 'owner', 'expiresAt'],
  },
  access: {
    read: isAdmin,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  typescript: {
    interface: 'AccessKey',
  },
  fields: [
    {
      name: 'key',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'hwid',
      type: 'text',
      required: false,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Revoked', value: 'revoked' },
        { label: 'Expired', value: 'expired' },
      ],
    },
    {
      name: 'expiresAt',
      type: 'date',
    },
    {
      name: 'owner',
      type: 'text',
    },
  ],
}

export default AccessKeys
