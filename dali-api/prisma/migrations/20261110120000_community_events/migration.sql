-- CreateTable
CREATE TABLE "CommunityEvent" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "meetingUrl" TEXT,
    "placeName" TEXT,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "audience" TEXT NOT NULL DEFAULT 'alumni_and_students',
    "notifyNearby" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityEventRsvp" (
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityEventRsvp_pkey" PRIMARY KEY ("eventId","userId")
);

-- CreateIndex
CREATE INDEX "CommunityEvent_startsAt_idx" ON "CommunityEvent"("startsAt");

-- CreateIndex
CREATE INDEX "CommunityEvent_hostId_idx" ON "CommunityEvent"("hostId");

-- CreateIndex
CREATE INDEX "CommunityEventRsvp_userId_idx" ON "CommunityEventRsvp"("userId");

-- AddForeignKey
ALTER TABLE "CommunityEvent" ADD CONSTRAINT "CommunityEvent_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityEventRsvp" ADD CONSTRAINT "CommunityEventRsvp_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CommunityEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityEventRsvp" ADD CONSTRAINT "CommunityEventRsvp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
