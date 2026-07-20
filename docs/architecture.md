# Architecture

This repository is split as a small product monorepo instead of a nested project directory.

## Frontend

`frontend/` contains the Astro public site for `heysh1n.com.tr`.

Responsibilities:

- Render the portfolio UI.
- Fetch portfolio content from Payload REST endpoints.
- Stay deployable as a static or server-rendered Astro frontend.

Local URL:

```text
http://localhost:4321
```

## Backend

`backend/` contains Payload CMS v3 running on Next.js App Router with PostgreSQL.

Responsibilities:

- Payload admin panel.
- Portfolio collections: `Projects`, `Technologies`.
- Private SFCP metadata: `AccessKeys`.
- REST endpoints for SFCP license validation, key generation, and update manifests.

Local URL:

```text
http://localhost:3000
```

## SFCP API Surface

```text
POST /api/v1/validate
POST /api/v1/licenses/generate
GET  /api/sfcp/update.json
```

`POST /api/v1/validate` is called by the SFCP binary. It accepts a license key and HWID, binds the key on first successful validation, rejects mismatched HWIDs, and returns a signed token.

`POST /api/v1/licenses/generate` is an authenticated admin endpoint for creating new access keys.

`GET /api/sfcp/update.json` serves the updater manifest consumed by SFCP.

## Data Flow

```text
Astro frontend
  -> Payload REST API
  -> PostgreSQL

SFCP binary
  -> Payload SFCP endpoints
  -> AccessKeys collection
  -> PostgreSQL
```

This keeps the portfolio content workflow and the commercial SFCP infrastructure in one backend without mixing them into the public Astro site.
