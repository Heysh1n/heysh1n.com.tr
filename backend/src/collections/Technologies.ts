import type { CollectionConfig } from 'payload'

import { isAdminOrOwner } from './Users'
import { triggerCloudflareDeploy } from '../hooks/triggerCloudflareDeploy'

export type TechnologyCategory =
  | 'os'
  | 'tools'
  | 'os_tools'
  | 'languages'
  | 'networks'
  | 'game_servers'
  | 'frameworks'
  | 'databases'
  | 'devops'
  | 'security'
  | 'ui_ux'

export interface TechnologyDocument {
  name: string
  category?: TechnologyCategory | null
}

const technologyCategoryOptions = [
  { label: 'OS', value: 'os' },
  { label: 'Tools', value: 'tools' },
  { label: 'OS & Tools', value: 'os_tools' },
  { label: 'Languages', value: 'languages' },
  { label: 'Networks', value: 'networks' },
  { label: 'Game Servers', value: 'game_servers' },
  { label: 'Frameworks', value: 'frameworks' },
  { label: 'Databases', value: 'databases' },
  { label: 'DevOps', value: 'devops' },
  { label: 'Security', value: 'security' },
  { label: 'UI/UX', value: 'ui_ux' },
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
    group: 'Portfolio & Content',
    defaultColumns: ['name', 'category', 'updatedAt'],
  },
  typescript: {
    interface: 'Technology',
  },
  hooks: {
    afterChange: [triggerCloudflareDeploy],
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'name',
          label: 'Name',
          type: 'text',
          required: true,
        },
        {
          name: 'category',
          label: 'Category',
          type: 'select',
          options: technologyCategoryOptions,
        },
      ],
    },
  ],
}
