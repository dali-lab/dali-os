-- CreateEnum
CREATE TYPE "DevicePairingStatus" AS ENUM ('Pending', 'Approved', 'Consumed', 'Cancelled', 'Expired');

-- CreateTable
CREATE TABLE "DevicePairing" (
    "id" TEXT NOT NULL,
    "deviceCodeHash" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "status" "DevicePairingStatus" NOT NULL DEFAULT 'Pending',
    "deviceLabel" TEXT NOT NULL,
    "userId" TEXT,
    "desktopSessionId" TEXT,
    "handoffCodeHash" TEXT,
    "handoffExpiresAt" TIMESTAMP(3),
    "handoffUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "startIp" TEXT,
    "startUserAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DevicePairing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DevicePairing_deviceCodeHash_key" ON "DevicePairing"("deviceCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "DevicePairing_userCode_key" ON "DevicePairing"("userCode");

-- CreateIndex
CREATE INDEX "DevicePairing_status_expiresAt_idx" ON "DevicePairing"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "DevicePairing_userId_idx" ON "DevicePairing"("userId");

-- CreateIndex
CREATE INDEX "DevicePairing_expiresAt_idx" ON "DevicePairing"("expiresAt");

-- AddForeignKey
ALTER TABLE "DevicePairing" ADD CONSTRAINT "DevicePairing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
