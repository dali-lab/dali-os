FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS runtime-deps
ARG OMIT_DEV=true
WORKDIR /app
COPY package.json package-lock.json ./
RUN if [ "$OMIT_DEV" = "true" ]; then npm ci --omit=dev; else npm ci; fi

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
# Full app/ (not just app/generated): prisma/seed.ts imports app/projects/lib/**
# and app/types to replay the real interpret→validate→persist pipeline at
# release time. .dockerignore still excludes .env, build, node_modules.
COPY --from=build /app/app ./app
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
# The Fly release command runs `tsx prisma/seed.ts`. Runtime node_modules is
# --omit=dev so it lacks tsx; tsx also needs tsconfig.json to resolve the
# `~/*` -> ./app/* path alias used by the app code the seed imports. Overlay
# the pinned tsx (+ its esbuild/get-tsconfig deps) and tsconfig from the build
# stage instead of letting `npx` pull an unpinned tsx from the network.
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/node_modules/tsx ./node_modules/tsx
COPY --from=build /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=build /app/node_modules/@esbuild ./node_modules/@esbuild
COPY --from=build /app/node_modules/get-tsconfig ./node_modules/get-tsconfig
COPY --from=build /app/node_modules/resolve-pkg-maps ./node_modules/resolve-pkg-maps
# .bin/tsx is a symlink in the build stage; copying it as a file breaks it.
# Recreate it so the bare `tsx` in prisma.config.ts resolves via PATH.
RUN ln -sf ../tsx/dist/cli.mjs ./node_modules/.bin/tsx
EXPOSE 3000
CMD ["npm", "run", "start"]
