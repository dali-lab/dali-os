-- Move isReady from ChallengeVersionApplicationCycle to DomainApplicationCycle

ALTER TABLE "ChallengeVersionApplicationCycle" DROP COLUMN "isReady";

ALTER TABLE "DomainApplicationCycle" ADD COLUMN "isReady" BOOLEAN NOT NULL DEFAULT false;
