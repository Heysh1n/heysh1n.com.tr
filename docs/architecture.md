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
- Private SFCP metadata: `AccessKeys`, `KeyLogs`, `Releases`.
- REST endpoints for SFCP license validation, key generation, dynamic update manifests, and release artifact downloads.

Local URL:

```text
http://localhost:3000
```

## SFCP API Surface

```text
POST /api/v1/validate
POST /api/sfcp/verify
POST /api/v1/licenses/generate
GET  /api/sfcp/update.json
GET  /api/sfcp/vscode-update.json
GET  /api/sfcp/downloads/:filename
HEAD /api/sfcp/downloads/:filename
```

`POST /api/v1/validate` is called by the SFCP binary. It accepts a license key hash and HWID, binds the key on first successful validation, rejects mismatched HWIDs, and logs telemetry.

`POST /api/v1/licenses/generate` is an authenticated admin endpoint for creating new access keys.

`GET /api/sfcp/update.json` dynamically builds the multi-platform updater manifest for `sfc-pro` from published records in the `Releases` collection (`version` / `latest_version`, `platforms` map by OS/architecture such as `linux-x86_64`, `windows-x86_64`, `macos-arm64`, plus top-level fallback `download_url` and `sha256`).

`GET /api/sfcp/vscode-update.json` dynamically builds the updater manifest for `sfcp-vscode` pointing to the latest published `.vsix` package and its `sha256`.

`GET /api/sfcp/downloads/:filename` (and `HEAD`) streams published release binaries/packages directly from server storage with rate limiting, strict path-traversal guards, and safe attachment headers.

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
