-- AlterTable
ALTER TABLE "User" ADD COLUMN "walletPassUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WalletPassRegistration" (
    "id" TEXT NOT NULL,
    "deviceLibraryIdentifier" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "pushToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletPassRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletPassRegistration_deviceLibraryIdentifier_serialNumber_key" ON "WalletPassRegistration"("deviceLibraryIdentifier", "serialNumber");

-- CreateIndex
CREATE INDEX "WalletPassRegistration_serialNumber_idx" ON "WalletPassRegistration"("serialNumber");

-- AddForeignKey
ALTER TABLE "WalletPassRegistration" ADD CONSTRAINT "WalletPassRegistration_serialNumber_fkey" FOREIGN KEY ("serialNumber") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
