import type { GlobalConfig } from 'payload'

import { isAdminOrOwner } from '../collections/Users'
import { triggerCloudflareDeployGlobal } from '../hooks/triggerCloudflareDeploy'

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
  spotify_status?: {
    status?: string | null
    now_playing_endpoint?: string | null
    auth_endpoint?: string | null
  } | null
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
  hooks: {
    afterChange: [triggerCloudflareDeployGlobal],
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
      required: false,
      defaultValue: 'ytmusic',
      options: [
        { label: 'YouTube Music (Primary)', value: 'ytmusic' },
        { label: 'Last.fm (Legacy)', value: 'lastfm' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'ytmusic_url',
      label: 'YouTube Music URL',
      type: 'text',
      required: false,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'lastfm_user',
      label: 'Last.fm Username',
      type: 'text',
      required: false,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'spotify_status',
      label: 'Spotify Integration',
      type: 'group',
      admin: {
        description:
          'Spotify integration is managed live via OAuth endpoints: /api/spotify/now-playing and /api/spotify/login.',
      },
      fields: [
        {
          name: 'status',
          type: 'text',
          label: 'Status',
          defaultValue: 'Active via Spotify Web API (/api/spotify/now-playing)',
          admin: {
            readOnly: true,
            description: 'Playback data is streamed live from the Spotify Web API.',
          },
        },
        {
          name: 'now_playing_endpoint',
          type: 'text',
          label: 'Now Playing Endpoint',
          defaultValue: '/api/spotify/now-playing',
          admin: {
            readOnly: true,
            description: 'Public endpoint consumed by the frontend music widget.',
          },
        },
        {
          name: 'auth_endpoint',
          type: 'text',
          label: 'Authorization Endpoint',
          defaultValue: '/api/spotify/login',
          admin: {
            readOnly: true,
            description: 'Visit /api/spotify/login to authenticate and renew SPOTIFY_REFRESH_TOKEN.',
          },
        },
      ],
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
      access: {
        read: () => true,
      },
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
