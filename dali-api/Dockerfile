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

FROM node:22-alpine AS runtime
WORKDIR /app
# Headless Chromium for server-side PDF rendering (app/lib/pdf/render.server.ts).
# Playwright's own Chromium build doesn't run on Alpine/musl, so install the
# system package and point playwright-core at it (CHROMIUM_EXECUTABLE_PATH).
# Fonts cover Latin text + emoji so rendered documents aren't tofu. Kept as an
# early layer so it's cached across app-code changes.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      font-noto \
      font-noto-emoji
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
EXPOSE 3000
CMD ["npm", "run", "start"]

FROM runtime AS preview
COPY --from=build /app/app ./app
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/node_modules/tsx ./node_modules/tsx
COPY --from=build /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=build /app/node_modules/@esbuild ./node_modules/@esbuild
RUN ln -sf ../tsx/dist/cli.mjs ./node_modules/.bin/tsx
