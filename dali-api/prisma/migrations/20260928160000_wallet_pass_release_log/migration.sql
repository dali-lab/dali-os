-- CreateTable
CREATE TABLE "WalletPassReleaseLog" (
    "version" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "googlePatched" INTEGER NOT NULL DEFAULT 0,
    "googleFailed" INTEGER NOT NULL DEFAULT 0,
    "applePushed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WalletPassReleaseLog_pkey" PRIMARY KEY ("version")
);
