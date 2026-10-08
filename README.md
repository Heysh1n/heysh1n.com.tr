# heysh1n.com.tr Web Hub

Monorepo for the public portfolio frontend and the Payload CMS backend that powers content, admin workflows, and SFCP license/update APIs.

## Structure

```text
.
├─ frontend/          # Astro public site
├─ backend/           # Payload CMS v3 + Next.js App Router + PostgreSQL
├─ docs/              # Setup and architecture notes
├─ package.json       # Workspace helper scripts
└─ README.md
```

## Services

- `frontend/`: Astro site on `http://localhost:4321`. It consumes Payload REST endpoints for projects and technologies.
- `backend/`: Payload admin and API on `http://localhost:3000`. It stores portfolio content, manages access keys, validates SFCP licenses, and serves the SFCP update manifest.

## Environment

Create the backend env file from the example:

```sh
cp backend/.env.example backend/.env
```

Required backend variables:

```env
DATABASE_URI=postgresql://postgres:postgres@127.0.0.1:5432/payload_cms
PAYLOAD_SECRET=replace-with-a-long-random-secret
SFCP_LATEST_VERSION=0.0.0
SFCP_DOWNLOAD_URL=
SFCP_SHA256=
```

## Commands

Install dependencies for both workspaces:

```sh
npm install
```

Run the public site:

```sh
npm run dev:frontend
```

Run Payload CMS and API:

```sh
npm run dev:backend
```

Generate Payload types after collection changes:

```sh
npm run generate:types
```

Build both workspaces:

```sh
npm run build
```
