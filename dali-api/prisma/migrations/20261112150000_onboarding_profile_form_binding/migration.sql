-- CreateTable
CREATE TABLE "OnboardingProfileFormBinding" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingProfileFormBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnboardingProfileFormBinding_formId_idx" ON "OnboardingProfileFormBinding"("formId");

-- AddForeignKey
ALTER TABLE "OnboardingProfileFormBinding" ADD CONSTRAINT "OnboardingProfileFormBinding_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bind the form the app used to find by name, newest published first.
INSERT INTO "OnboardingProfileFormBinding" ("id", "formId", "updatedAt")
SELECT 'onboarding-profile-binding', "id", NOW()
FROM "Form"
WHERE "name" = 'Welcome to DALI! 👋' AND "published" = true
ORDER BY "createdAt" DESC
LIMIT 1;
