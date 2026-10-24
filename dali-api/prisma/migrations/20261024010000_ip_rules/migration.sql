-- CreateTable
CREATE TABLE "IpRule" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IpRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IpRule_kind_cidr_key" ON "IpRule"("kind", "cidr");

-- Dartmouth's campus network (eduroam included) shares egress addresses.
INSERT INTO "IpRule" ("id", "kind", "cidr", "reason", "source")
VALUES ('iprule_dartmouth_campus', 'trust', '129.170.0.0/16', 'Dartmouth campus network', 'manual')
ON CONFLICT DO NOTHING;
