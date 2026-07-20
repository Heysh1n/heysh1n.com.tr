import type { GlobalConfig } from 'payload'

import { isAdminOrOwner } from '../collections/Users'

export interface HomePageSocial {
  platform: string
  url: string
  enabled?: boolean | null
}

export interface HomePageGlobal {
  name: string
  role: string
  description: string
  lastfm_user?: string | null
  discord_id?: string | null
  socials?: HomePageSocial[] | null
}

export const HomePage: GlobalConfig = {
  slug: 'home-page',
  label: 'Home Page',
  access: {
    read: () => true,
    update: isAdminOrOwner,
  },
  admin: {
    group: 'Site',
  },
  typescript: {
    interface: 'HomePage',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      defaultValue: 'Heysh1n',
    },
    {
      name: 'role',
      type: 'text',
      required: true,
      defaultValue: 'Backend Engineer',
    },
    {
      name: 'description',
      type: 'textarea',
      required: true,
    },
    {
      name: 'lastfm_user',
      label: 'Last.fm Username',
      type: 'text',
    },
    {
      name: 'discord_id',
      label: 'Discord ID',
      type: 'text',
    },
    {
      name: 'socials',
      type: 'array',
      labels: {
        singular: 'Social Link',
        plural: 'Social Links',
      },
      fields: [
        {
          name: 'platform',
          type: 'text',
          required: true,
        },
        {
          name: 'url',
          type: 'text',
          required: true,
        },
        {
          name: 'enabled',
          type: 'checkbox',
          defaultValue: true,
        },
      ],
    },
  ],
}
