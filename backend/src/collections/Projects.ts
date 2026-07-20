import type { SerializedEditorState } from 'lexical'
import type { CollectionConfig, FieldHook } from 'payload'

import { isAdminOrOwner } from './Users'

export type ProjectStatus = 'active' | 'in_progress' | 'archived'

export interface ProjectDocument {
  id: number | string
  title: string
  slug: string
  description: string
  detailedContent: SerializedEditorState
  status?: ProjectStatus | null
  githubLink?: string | null
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
    defaultColumns: ['title', 'status', 'slug', 'updatedAt'],
  },
  typescript: {
    interface: 'Project',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      hooks: {
        beforeValidate: [populateSlug],
      },
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      required: true,
    },
    {
      name: 'detailedContent',
      type: 'richText',
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      options: projectStatusOptions,
      defaultValue: 'in_progress',
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'githubLink',
      type: 'text',
      admin: {
        position: 'sidebar',
      },
    },
  ],
}
