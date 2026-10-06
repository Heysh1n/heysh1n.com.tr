import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { AccessKeys } from './collections/AccessKeys'
import { KeyLogs } from './collections/KeyLogs'
import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Projects } from './collections/Projects'
import { Technologies } from './collections/Technologies'
import {
  generateLicenseEndpoint,
  updateManifestEndpoint,
  validateLicenseEndpoint,
} from './endpoints/sfcp'
import { HomePage } from './globals/HomePage'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const serverURL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'
const extraOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const allowedOrigins = Array.from(
  new Set([
    serverURL,
    'https://heysh1n.com.tr',
    'https://www.heysh1n.com.tr',
    'http://heysh1n.com.tr',
    'http://www.heysh1n.com.tr',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:4321',
    'http://127.0.0.1:4321',
    'http://localhost:4322',
    'http://127.0.0.1:4322',
    ...extraOrigins,
  ]),
)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: {
      titleSuffix: ' // Heysh1n Hub',
      icons: [
        {
          rel: 'icon',
          type: 'image/svg+xml',
          url: '/favicon.svg',
        },
      ],
      openGraph: {
        title: 'Heysh1n Control Panel',
        description: 'Systems, Portfolio & SFCP License Management',
      },
    },
    components: {
      graphics: {
        Logo: {
          path: '/components/AdminLogo',
          exportName: 'AdminLogo',
        },
        Icon: {
          path: '/components/AdminIcon',
          exportName: 'AdminIcon',
        },
      },
      views: {
        dashboard: {
          Component: {
            path: '/components/AdminDashboard',
            exportName: 'AdminDashboard',
          },
          path: '/',
        },
      },
    },
  },
  routes: {
    admin: '/panel',
  },
  collections: [Users, Media, Projects, Technologies, AccessKeys, KeyLogs],
  globals: [HomePage],
  endpoints: [validateLicenseEndpoint, generateLicenseEndpoint, updateManifestEndpoint],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URI || '',
    },
  }),
  sharp,
  plugins: [],
  serverURL,
  cors: allowedOrigins,
  csrf: allowedOrigins,
})
