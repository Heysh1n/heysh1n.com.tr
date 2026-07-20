import type { CollectionConfig } from 'payload'

import { isAdminOrOwner } from './Users'

export type TechnologyCategory = 'os_tools' | 'languages' | 'networks' | 'game_servers'

export interface TechnologyDocument {
  name: string
  category?: TechnologyCategory | null
}

const technologyCategoryOptions = [
  { label: 'OS Tools', value: 'os_tools' },
  { label: 'Languages', value: 'languages' },
  { label: 'Networks', value: 'networks' },
  { label: 'Game Servers', value: 'game_servers' },
] satisfies Array<{ label: string; value: TechnologyCategory }>

export const Technologies: CollectionConfig = {
  slug: 'technologies',
  access: {
    read: () => true,
    create: isAdminOrOwner,
    update: isAdminOrOwner,
    delete: isAdminOrOwner,
  },
  labels: {
    singular: 'Technology',
    plural: 'Technologies',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'category', 'updatedAt'],
  },
  typescript: {
    interface: 'Technology',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'category',
      type: 'select',
      options: technologyCategoryOptions,
    },
  ],
}
