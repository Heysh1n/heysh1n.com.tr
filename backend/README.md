# heysh1n Backend

Payload CMS v3 backend for the portfolio content model and SFCP commercial API.

## Stack

- Payload CMS v3
- Next.js App Router
- TypeScript
- PostgreSQL through `@payloadcms/db-postgres`

## Local Setup

Create an env file:

```sh
cp .env.example .env
```

Run from the repository root:

```sh
npm run dev:backend
```

Or run directly inside this workspace:

```sh
npm run dev
```

The admin panel runs at:

```text
http://localhost:3000/panel
```

## Payload Commands

```sh
npm run generate:types
npm run generate:importmap
npm run payload -- migrate:create portfolio-and-sfcp
npm run payload -- migrate
```

## SFCP Endpoints

```text
POST /api/v1/validate
POST /api/v1/licenses/generate
GET  /api/sfcp/update.json
```

## Docker

From the repository root:

```sh
docker build -f backend/Dockerfile .
```

For local Postgres + Payload development:

```sh
docker compose -f backend/docker-compose.yml up
```
