-- DropIndex
DROP INDEX "WorkingHoursDay_userId_dayOfWeek_key";

-- DropIndex
DROP INDEX "WorkingHoursDay_userId_idx";

-- CreateIndex
CREATE INDEX "WorkingHoursDay_userId_dayOfWeek_idx" ON "WorkingHoursDay"("userId", "dayOfWeek");
