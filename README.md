# DALI-OS




## Quickstart with Docker Compose
| Service | Image | Ports | Description |
| -------- | -------- | -------- | ----------- |
| db | postgres:16-alpine | 5432 | PostgreSQL database |
| api | ./dali-api | 3001, 5555 | Runs Prisma migrate, API, and Prisma Studio |

## Environment Variables (with Docker Compose)
| Variable | Description | Default Value |
| -------- | ----------- | ------------- |
| GOOGLE_CLIENT_ID | Google OAuth ID | None | 
| GOOGLE_CLIENT_SECRET | Google OAuth Secret | None |
- When using Docker Compose locally, only the Google OAuth credentials (in the top level .env) are required
