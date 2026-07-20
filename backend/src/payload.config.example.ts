import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { AccessKeys, Projects, Technologies } from './collections'
import {
  generateLicenseEndpoint,
  updateManifestEndpoint,
  validateLicenseEndpoint,
} from './endpoints/sfcp'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  routes: {
    admin: '/panel',
  },
  collections: [Projects, Technologies, AccessKeys],
  endpoints: [validateLicenseEndpoint, generateLicenseEndpoint, updateManifestEndpoint],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET ?? '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URI ?? '',
    },
  }),
})
