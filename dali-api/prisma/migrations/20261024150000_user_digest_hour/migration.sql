-- Per-member digest send hour (ET). Null keeps the job default.
ALTER TABLE "User" ADD COLUMN "digestHourEt" INTEGER;
