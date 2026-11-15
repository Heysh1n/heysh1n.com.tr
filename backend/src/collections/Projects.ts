import type { CollectionConfig, FieldHook } from 'payload'

import { isAdminOrOwner } from './Users'
import { triggerCloudflareDeploy } from '../hooks/triggerCloudflareDeploy'

export type ProjectStatus = 'active' | 'in_progress' | 'archived'

export interface ProjectDocument {
  id: number | string
  title: string
  slug: string
  description: string
  markdown_description?: string | null
  cta_label?: string | null
  cta_url?: string | null
  github_url?: string | null
  demo_url?: string | null
  status?: ProjectStatus | null
}

const projectStatusOptions = [
  { label: 'Active', value: 'active' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Archived', value: 'archived' },
] satisfies Array<{ label: string; value: ProjectStatus }>

const formatSlug = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

const populateSlug: FieldHook<ProjectDocument, string, ProjectDocument> = ({ siblingData, value }) => {
  const source = value || siblingData?.title

  if (!source) {
    return value ?? ''
  }

  return formatSlug(source)
}

export const Projects: CollectionConfig = {
  slug: 'projects',
  access: {
    read: () => true,
    create: isAdminOrOwner,
    update: isAdminOrOwner,
    delete: isAdminOrOwner,
  },
  labels: {
    singular: 'Project',
    plural: 'Projects',
  },
  admin: {
    useAsTitle: 'title',
    group: 'Portfolio & Content',
    defaultColumns: ['title', 'status', 'slug', 'updatedAt'],
  },
  typescript: {
    interface: 'Project',
  },
  hooks: {
    afterChange: [triggerCloudflareDeploy],
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Overview',
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'text',
              required: true,
            },
            {
              name: 'slug',
              label: 'Slug',
              type: 'text',
              required: true,
              unique: true,
              index: true,
              hooks: {
                beforeValidate: [populateSlug],
              },
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: projectStatusOptions,
              defaultValue: 'in_progress',
            },
          ],
        },
        {
          label: 'Content',
          fields: [
            {
              name: 'description',
              label: 'Summary',
              type: 'textarea',
              required: true,
            },
            {
              name: 'markdown_description',
              label: 'Description.md',
              type: 'textarea',
              required: false,
              admin: {
                description:
                  'Full project details / README in Markdown format shown inside the modal',
              },
            },
          ],
        },
        {
          label: 'Links & CTA',
          fields: [
            {
              name: 'github_url',
              label: 'GitHub Repository URL',
              type: 'text',
              required: false,
              admin: {
                description: 'GitHub repository URL',
              },
            },
            {
              name: 'demo_url',
              label: 'Demo / Preview URL',
              type: 'text',
              required: false,
              admin: {
                description: 'Target URL for demo / preview',
              },
            },
            {
              name: 'cta_label',
              label: 'Call-to-Action Label',
              type: 'text',
              required: false,
              admin: {
                description: "Modal button label, e.g., 'Купить ключ' or 'Открыть на GitHub'",
              },
            },
            {
              name: 'cta_url',
              label: 'Call-to-Action URL',
              type: 'text',
              required: false,
              admin: {
                description: 'Target URL for the modal action button',
              },
            },
          ],
        },
      ],
    },
  ],
}
