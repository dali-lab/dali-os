FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Public config inlined by Vite at build time (ends up in the client bundle).
ARG VITE_DALI_DB_URL
ARG VITE_FRONTEND_URL
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_DALI_DB_URL=$VITE_DALI_DB_URL
ENV VITE_FRONTEND_URL=$VITE_FRONTEND_URL
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "run", "start"]