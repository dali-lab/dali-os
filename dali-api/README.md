# Welcome to React Router!

A modern, production-ready template for building full-stack React applications using React Router.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/remix-run/react-router-templates/tree/main/default)

## Features

- 🚀 Server-side rendering
- ⚡️ Hot Module Replacement (HMR)
- 📦 Asset bundling and optimization
- 🔄 Data loading and mutations
- 🔒 TypeScript by default
- 🎉 TailwindCSS for styling
- 📖 [React Router docs](https://reactrouter.com/)

## Getting Started

### Installation

Install the dependencies:

```bash
npm install
```

### Development

Start the development server with HMR:

```bash
npm run dev
```

Your application will be available at `http://localhost:5173`.

### Seeding the Database

With Docker Compose running, seed the database with sample data:

```bash
docker compose exec api npx tsx prisma/seed.ts
```

## Building for Production

Create a production build:

```bash
npm run build
```

## Deployment

The API deploys to [Fly.io](https://fly.io) via GitHub Actions (`.github/workflows/deploy.yml`). There are three environments, each with a different database strategy:

| Environment | Branch | Fly App | Neon Branch | DB Strategy |
|---|---|---|---|---|
| **Dev** | `dev` | `dali-api-dev` | `development` | Full wipe + migrate + seed |
| **Staging** | `staging` | `dali-api-staging` | `staging` | Restore from prod + migrate |
| **Prod** | `prod` | `dali-api-prod` | `production` | Migrate only |

- **Dev**: The database is wiped on every deploy. All Prisma migrations run from scratch on an empty database, then seed data is applied. This ensures migrations are always valid from a clean slate. Dev dependencies (like `tsx`) are included in the Docker image so the seed script can run.
- **Staging**: The database is restored from the production Neon branch before deploying. New migrations are applied on top of real prod data. This catches data-incompatible migrations before they reach prod.
- **Prod**: Only new Prisma migrations are applied. No database prep or seeding.

## Styling

This template comes with [Tailwind CSS](https://tailwindcss.com/) already configured for a simple default starting experience. You can use whatever CSS framework you prefer.

---

Built with ❤️ using React Router.
