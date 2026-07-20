import type { CollectionConfig } from 'payload'

import { isOwner } from './Users'

export const KeyLogs: CollectionConfig = {
  slug: 'key-logs',
  access: {
    read: isOwner,
    create: isOwner,
    update: () => false,
    delete: isOwner,
  },
  labels: {
    singular: 'Key Log',
    plural: 'Key Logs',
  },
  admin: {
    group: 'Logs',
    defaultColumns: ['licenseKey', 'hwid', 'ipAddress', 'createdAt'],
  },
  typescript: {
    interface: 'KeyLog',
  },
  fields: [
    {
      name: 'licenseKey',
      type: 'relationship',
      relationTo: 'access-keys',
      required: true,
      admin: {
        description: 'The license key that was validated.',
      },
    },
    {
      name: 'hwid',
      type: 'text',
      required: true,
      admin: {
        description: 'Hardware ID of the client device.',
      },
    },
    {
      name: 'ipAddress',
      type: 'text',
      admin: {
        description: 'Client IP address captured at validation time.',
        position: 'sidebar',
      },
    },
  ],
}
