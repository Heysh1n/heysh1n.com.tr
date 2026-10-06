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
  music_provider?: 'ytmusic' | 'lastfm' | null
  ytmusic_url?: string | null
  lastfm_user?: string | null
  discord_id?: string | null
  discord_username?: string | null
  discord_tag?: string | null
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
      name: 'music_provider',
      label: 'Music Provider',
      type: 'select',
      defaultValue: 'ytmusic',
      options: [
        { label: 'YouTube Music (Primary)', value: 'ytmusic' },
        { label: 'Last.fm (Legacy)', value: 'lastfm' },
      ],
    },
    {
      name: 'ytmusic_url',
      label: 'YouTube Music URL (Track or Playlist)',
      type: 'text',
      admin: {
        description: 'Link to song on music.youtube.com or youtube.com (e.g. https://music.youtube.com/watch?v=...)',
      },
    },
    {
      name: 'lastfm_user',
      label: 'Last.fm Username (Legacy)',
      type: 'text',
    },
    {
      name: 'discord_id',
      label: 'Discord ID',
      type: 'text',
      admin: {
        description: 'Discord user snowflake ID for real-time presence (e.g. 995737379417640961)',
      },
    },
    {
      name: 'discord_username',
      label: 'Discord Username / Handle',
      type: 'text',
      defaultValue: 'heysh1n',
      admin: {
        description: 'Discord handle e.g. heysh1n or @heysh1n',
      },
    },
    {
      name: 'discord_tag',
      label: 'Discord Guild / Clan Tag',
      type: 'text',
      defaultValue: 'HEYSH1N',
      admin: {
        description: 'Guild or Clan tag badge displayed next to the name (e.g. HEYSH1N, DEV, etc.)',
      },
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
