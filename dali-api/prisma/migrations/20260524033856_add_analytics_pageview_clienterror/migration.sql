-- Site analytics tables: PageView for navigation telemetry, ClientError for
-- uncaught browser errors. Additive only; no FKs to User so rows survive
-- account deletion (same convention as AuditLog).

CREATE TABLE "PageView" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "sessionId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "referrer" TEXT,
    "durationMs" INTEGER,

    CONSTRAINT "PageView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PageView_createdAt_idx" ON "PageView"("createdAt");
CREATE INDEX "PageView_userId_createdAt_idx" ON "PageView"("userId", "createdAt");
CREATE INDEX "PageView_path_createdAt_idx" ON "PageView"("path", "createdAt");

CREATE TABLE "ClientError" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "path" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "userAgent" TEXT,
    "release" TEXT,

    CONSTRAINT "ClientError_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientError_createdAt_idx" ON "ClientError"("createdAt");
CREATE INDEX "ClientError_message_createdAt_idx" ON "ClientError"("message", "createdAt");
