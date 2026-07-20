# Payload CMS v3 + PostgreSQL Setup

The Payload app lives in `backend/`. It uses Payload CMS v3, Next.js App Router, TypeScript, and `@payloadcms/db-postgres`.

## Fresh Scaffold Command

For a new Payload v3 project with PostgreSQL:

```sh
npx create-payload-app@latest backend --template blank --db postgres --db-connection-string "postgresql://postgres:postgres@127.0.0.1:5432/payload_cms" --use-npm --no-agent
```

In this repository the app has already been moved into `backend/` as part of the monorepo.

## Backend Layout

```text
backend/
├─ .env.example
├─ package.json
├─ next.config.ts
├─ tsconfig.json
└─ src/
   ├─ app/
   │  ├─ (payload)/
   │  │  ├─ panel/
   │  │  └─ api/
   │  └─ (frontend)/
   ├─ collections/
   │  ├─ AccessKeys.ts
   │  ├─ Media.ts
   │  ├─ Projects.ts
   │  ├─ Technologies.ts
   │  └─ Users.ts
   ├─ components/
   ├─ endpoints/
   │  └─ sfcp.ts
   └─ payload.config.ts
```

## Environment

Create a local env file:

```sh
cp backend/.env.example backend/.env
```

Required values:

```env
DATABASE_URI=postgresql://postgres:postgres@127.0.0.1:5432/payload_cms
PAYLOAD_SECRET=replace-with-a-long-random-secret
```

Optional SFCP update manifest values:

```env
SFCP_LATEST_VERSION=0.0.0
SFCP_DOWNLOAD_URL=
SFCP_SHA256=
```

## Migrations And Development

From the repository root:

```sh
npm run payload -- migrate:create portfolio-and-sfcp
npm run payload -- migrate
npm run dev:backend
```

Payload's Postgres adapter can push schema changes in local development, but explicit migrations are the safer workflow for shared, staging, and production databases.

## Config Registration

Collections and SFCP endpoints are registered in `backend/src/payload.config.ts`:

```ts
collections: [Users, Media, Projects, Technologies, AccessKeys],
endpoints: [validateLicenseEndpoint, generateLicenseEndpoint, updateManifestEndpoint],
```
