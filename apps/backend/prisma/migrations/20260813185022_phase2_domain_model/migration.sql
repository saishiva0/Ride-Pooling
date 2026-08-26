-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis" WITH VERSION "3.6.2";

-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RideRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PricingType" AS ENUM ('STANDARD', 'CUSTOM');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('RIDE_CREATED', 'RIDE_PUBLISHED', 'RIDE_UPDATED', 'RIDE_REQUESTED', 'REQUEST_ACCEPTED', 'REQUEST_REJECTED', 'REQUEST_CANCELLED', 'RIDE_CONFIRMED', 'RIDE_STARTED', 'RIDE_CANCELLED', 'RIDE_COMPLETED', 'RIDE_EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ride" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "pickupLocationId" TEXT NOT NULL,
    "destinationLocationId" TEXT NOT NULL,
    "departureDateTime" TIMESTAMP(3) NOT NULL,
    "totalSeats" INTEGER NOT NULL,
    "vehicleType" TEXT,
    "discoveryRadiusKm" DOUBLE PRECISION,
    "pricingType" "PricingType" NOT NULL,
    "pricePerKm" DECIMAL(6,2) NOT NULL,
    "estimatedDistanceKm" DECIMAL(8,2),
    "estimatedContribution" DECIMAL(10,2),
    "status" "RideStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RideRequest" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedSeats" INTEGER NOT NULL DEFAULT 1,
    "status" "RideRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RideRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RideParticipant" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "seatsAllocated" INTEGER NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'CONFIRMED',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RideParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RideStatusHistory" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "fromStatus" "RideStatus",
    "toStatus" "RideStatus" NOT NULL,
    "changedByUserId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RideStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "readAt" TIMESTAMP(3),
    "rideId" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Ride_creatorId_idx" ON "Ride"("creatorId");

-- CreateIndex
CREATE INDEX "Ride_status_idx" ON "Ride"("status");

-- CreateIndex
CREATE INDEX "Ride_departureDateTime_idx" ON "Ride"("departureDateTime");

-- CreateIndex
CREATE INDEX "Ride_status_departureDateTime_idx" ON "Ride"("status", "departureDateTime");

-- CreateIndex
CREATE INDEX "Ride_pickupLocationId_idx" ON "Ride"("pickupLocationId");

-- CreateIndex
CREATE INDEX "Ride_destinationLocationId_idx" ON "Ride"("destinationLocationId");

-- CreateIndex
CREATE INDEX "RideRequest_rideId_idx" ON "RideRequest"("rideId");

-- CreateIndex
CREATE INDEX "RideRequest_userId_idx" ON "RideRequest"("userId");

-- CreateIndex
CREATE INDEX "RideRequest_rideId_status_idx" ON "RideRequest"("rideId", "status");

-- CreateIndex
CREATE INDEX "RideRequest_status_idx" ON "RideRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RideParticipant_requestId_key" ON "RideParticipant"("requestId");

-- CreateIndex
CREATE INDEX "RideParticipant_rideId_idx" ON "RideParticipant"("rideId");

-- CreateIndex
CREATE INDEX "RideParticipant_userId_idx" ON "RideParticipant"("userId");

-- CreateIndex
CREATE INDEX "RideStatusHistory_rideId_createdAt_idx" ON "RideStatusHistory"("rideId", "createdAt");

-- CreateIndex
CREATE INDEX "RideStatusHistory_rideId_idx" ON "RideStatusHistory"("rideId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_rideId_idx" ON "Notification"("rideId");

-- CreateIndex
CREATE INDEX "Notification_requestId_idx" ON "Notification"("requestId");

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideRequest" ADD CONSTRAINT "RideRequest_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideRequest" ADD CONSTRAINT "RideRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideParticipant" ADD CONSTRAINT "RideParticipant_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideParticipant" ADD CONSTRAINT "RideParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideParticipant" ADD CONSTRAINT "RideParticipant_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RideRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideStatusHistory" ADD CONSTRAINT "RideStatusHistory_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideStatusHistory" ADD CONSTRAINT "RideStatusHistory_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RideRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Phase 2 custom SQL — features Prisma's schema language cannot express
-- natively: CHECK constraints, a PostGIS generated spatial column + GiST
-- index, and partial (filtered) unique indexes. See
-- `docs/development/database.md` and `apps/backend/prisma/schema.prisma`
-- header comment for rationale. No business logic (triggers/procedures) is
-- introduced here — only structural/data-integrity constraints.
-- ---------------------------------------------------------------------------

-- CheckConstraint: User must have at least one contact method
-- (`docs/domain/domain-model.md` §2.1 — "phone/email").
ALTER TABLE "User" ADD CONSTRAINT "User_contact_required"
  CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL);

-- CheckConstraint: Location coordinates must be valid WGS84 lat/lng
-- (`docs/domain/domain-model.md` §5.2).
ALTER TABLE "Location" ADD CONSTRAINT "Location_latitude_range"
  CHECK ("latitude" >= -90 AND "latitude" <= 90);
ALTER TABLE "Location" ADD CONSTRAINT "Location_longitude_range"
  CHECK ("longitude" >= -180 AND "longitude" <= 180);

-- PostGIS generated spatial column derived from latitude/longitude.
-- SRID 4326 per `docs/domain/domain-model.md` §5.2. Prisma cannot express
-- generated columns or PostGIS geometry types natively, so this is added
-- via custom SQL. The column is STORED and kept in sync automatically by
-- Postgres whenever latitude/longitude change — no application code or
-- trigger required.
ALTER TABLE "Location" ADD COLUMN "point" geometry(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint("longitude"::double precision, "latitude"::double precision), 4326)
  ) STORED;

-- Spatial (GiST) index to support future "nearby ride" queries
-- (`docs/domain/matching-model.md` §8 — geospatial indexing for nearby
-- queries). No matching query logic is implemented in this phase.
CREATE INDEX "Location_point_idx" ON "Location" USING GIST ("point");

-- CheckConstraint: Ride basic integrity (`docs/domain/ride-engine.md` §5
-- invariants — non-negative/positive values). Exact configured pricing
-- range (₹2-6) and seat maximum are Ride Engine config (OD-003/OD-006),
-- not hardcoded here — only universal sanity bounds are enforced.
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_totalSeats_positive"
  CHECK ("totalSeats" >= 1);
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_pricePerKm_positive"
  CHECK ("pricePerKm" > 0);
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_estimatedDistanceKm_nonnegative"
  CHECK ("estimatedDistanceKm" IS NULL OR "estimatedDistanceKm" >= 0);
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_estimatedContribution_nonnegative"
  CHECK ("estimatedContribution" IS NULL OR "estimatedContribution" >= 0);
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_discoveryRadiusKm_positive"
  CHECK ("discoveryRadiusKm" IS NULL OR "discoveryRadiusKm" > 0);

-- CheckConstraint: pickup and destination must be distinct locations
-- (`docs/domain/ride-engine.md` §4.2 — "Pickup ≠ destination").
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_pickup_destination_distinct"
  CHECK ("pickupLocationId" <> "destinationLocationId");

-- CheckConstraint: RideRequest / RideParticipant seat counts must be positive
-- (`docs/domain/domain-model.md` §2.3/§2.4).
ALTER TABLE "RideRequest" ADD CONSTRAINT "RideRequest_requestedSeats_positive"
  CHECK ("requestedSeats" >= 1);
ALTER TABLE "RideParticipant" ADD CONSTRAINT "RideParticipant_seatsAllocated_positive"
  CHECK ("seatsAllocated" >= 1);

-- Partial unique index: prevent duplicate ACTIVE requests from the same user
-- for the same ride (`docs/domain/ride-engine.md` §5 invariant 5, §6
-- "duplicate request race"; `docs/domain/domain-model.md` §2.3). Prisma's
-- schema language does not support partial/filtered indexes on PostgreSQL,
-- so this is added via custom SQL.
CREATE UNIQUE INDEX "RideRequest_active_unique"
  ON "RideRequest" ("rideId", "userId")
  WHERE "status" IN ('PENDING', 'ACCEPTED');

-- Partial unique index: prevent duplicate CONFIRMED participation by the same
-- user on the same ride (`docs/domain/domain-model.md` §2.4, §13 uniqueness
-- requirement).
CREATE UNIQUE INDEX "RideParticipant_confirmed_unique"
  ON "RideParticipant" ("rideId", "userId")
  WHERE "status" = 'CONFIRMED';
