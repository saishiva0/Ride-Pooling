/**
 * Phase 2 development seed data.
 *
 * ⚠️  DEVELOPMENT DATA ONLY — not representative of real users, rides, or
 * production data. Deterministic (fixed values, no randomness) so re-running
 * produces the same dataset. Exercises every relationship in the domain
 * model: User, Location, Ride (all 7 lifecycle statuses), RideRequest,
 * RideParticipant, RideStatusHistory, Notification.
 *
 * Pricing respects `docs/domain/pricing-model.md`: STANDARD = ₹4/km,
 * CUSTOM within ₹2–₹6/km. No business logic (no lifecycle transitions, no
 * contribution calculation service) — this only inserts historical facts
 * that a future Ride Engine would have produced.
 *
 * Location coordinates are illustrative Bengaluru-area points used only to
 * exercise spatial storage; no launch city has been decided (OD-016).
 *
 * Usage: pnpm --filter @ridepool/backend db:seed
 */
import { PrismaClient, PricingType, RideStatus } from '@prisma/client';

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

async function resetDomainData(): Promise<void> {
  // Delete in dependency order (children before parents). Only domain
  // tables are touched — PostGIS system tables (`spatial_ref_sys`) and
  // `_prisma_migrations` are never modified.
  await prisma.notification.deleteMany();
  await prisma.rideStatusHistory.deleteMany();
  await prisma.rideParticipant.deleteMany();
  await prisma.rideRequest.deleteMany();
  await prisma.ride.deleteMany();
  await prisma.location.deleteMany();
  await prisma.user.deleteMany();
}

async function main(): Promise<void> {
  console.log('[seed] Seeding DEVELOPMENT data into the RidePool database...');

  await resetDomainData();

  // ---------------------------------------------------------------------
  // Users — mix of creator-only, participant-only, and dual-role, matching
  // `docs/product/user-personas.md` archetypes. No auth credentials
  // (development seed predates the Phase 3.18 login flow; users are created
  // directly, as before).
  // ---------------------------------------------------------------------
  const riya = await prisma.user.create({
    data: { name: 'Riya Sharma', phone: '+919800000001' },
  });
  const arjun = await prisma.user.create({
    data: { name: 'Arjun Mehta', phone: '+919800000002' },
  });
  const meera = await prisma.user.create({
    data: {
      name: 'Meera Iyer',
      phone: '+919800000003',
      email: 'meera.iyer@example.dev',
    },
  });
  const harsha = await prisma.user.create({
    data: { name: 'Harsha Rao', email: 'harsha.rao@example.dev' },
  });
  const vikram = await prisma.user.create({
    data: { name: 'Vikram Nair', phone: '+919800000005' },
  });

  // ---------------------------------------------------------------------
  // Locations — pickup/destination pairs for each ride below.
  // ---------------------------------------------------------------------
  const indiranagar = await prisma.location.create({
    data: { latitude: 12.9716, longitude: 77.6412, label: 'Indiranagar' },
  });
  const whitefield = await prisma.location.create({
    data: { latitude: 12.9698, longitude: 77.75, label: 'Whitefield' },
  });
  const koramangala = await prisma.location.create({
    data: { latitude: 12.9352, longitude: 77.6245, label: 'Koramangala' },
  });
  const electronicCity = await prisma.location.create({
    data: { latitude: 12.8452, longitude: 77.6602, label: 'Electronic City' },
  });
  const marathahalli = await prisma.location.create({
    data: { latitude: 12.9591, longitude: 77.6974, label: 'Marathahalli' },
  });
  const mgRoad = await prisma.location.create({
    data: { latitude: 12.9758, longitude: 77.6045, label: 'MG Road' },
  });
  const hsrLayout = await prisma.location.create({
    data: { latitude: 12.9121, longitude: 77.6446, label: 'HSR Layout' },
  });

  // ---------------------------------------------------------------------
  // Rides — one per approved lifecycle status
  // (`docs/domain/ride-lifecycle.md` §1).
  // ---------------------------------------------------------------------

  // 1. DRAFT — being built by creator; not yet discoverable; estimate not
  // finalized (distance/contribution left null to exercise optionality).
  const draftRide = await prisma.ride.create({
    data: {
      creatorId: riya.id,
      pickupLocationId: indiranagar.id,
      destinationLocationId: whitefield.id,
      departureDateTime: daysFromNow(5),
      totalSeats: 3,
      vehicleType: 'car',
      discoveryRadiusKm: 8,
      pricingType: PricingType.STANDARD,
      pricePerKm: 4,
      status: RideStatus.DRAFT,
    },
  });
  await prisma.rideStatusHistory.create({
    data: {
      rideId: draftRide.id,
      fromStatus: null,
      toStatus: RideStatus.DRAFT,
      changedByUserId: riya.id,
      reason: 'Ride created',
    },
  });

  // 2. PUBLISHED — discoverable; has one PENDING request.
  const publishedRide = await prisma.ride.create({
    data: {
      creatorId: riya.id,
      pickupLocationId: koramangala.id,
      destinationLocationId: electronicCity.id,
      departureDateTime: daysFromNow(3),
      totalSeats: 2,
      vehicleType: 'car',
      discoveryRadiusKm: 6,
      pricingType: PricingType.STANDARD,
      pricePerKm: 4,
      estimatedDistanceKm: 12.3,
      estimatedContribution: 49.2,
      status: RideStatus.PUBLISHED,
    },
  });
  await prisma.rideStatusHistory.createMany({
    data: [
      {
        rideId: publishedRide.id,
        fromStatus: null,
        toStatus: RideStatus.DRAFT,
        changedByUserId: riya.id,
        reason: 'Ride created',
      },
      {
        rideId: publishedRide.id,
        fromStatus: RideStatus.DRAFT,
        toStatus: RideStatus.PUBLISHED,
        changedByUserId: riya.id,
        reason: 'Creator published the ride',
      },
    ],
  });
  const arjunRequestOnPublished = await prisma.rideRequest.create({
    data: {
      rideId: publishedRide.id,
      userId: arjun.id,
      requestedSeats: 1,
      status: 'PENDING',
    },
  });
  await prisma.notification.create({
    data: {
      userId: riya.id,
      type: 'RIDE_REQUESTED',
      title: 'New ride request',
      body: `${arjun.name} requested to join your ride to Electronic City.`,
      rideId: publishedRide.id,
      requestId: arjunRequestOnPublished.id,
    },
  });

  // 3. CONFIRMED — first request accepted (Meera confirmed); Harsha still
  // has a pending request since seats remain (CUSTOM pricing example).
  const confirmedRide = await prisma.ride.create({
    data: {
      creatorId: vikram.id,
      pickupLocationId: marathahalli.id,
      destinationLocationId: mgRoad.id,
      departureDateTime: daysFromNow(2),
      totalSeats: 4,
      vehicleType: 'car',
      discoveryRadiusKm: 10,
      pricingType: PricingType.CUSTOM,
      pricePerKm: 5,
      estimatedDistanceKm: 9.75,
      estimatedContribution: 48.75,
      status: RideStatus.CONFIRMED,
    },
  });
  await prisma.rideStatusHistory.createMany({
    data: [
      {
        rideId: confirmedRide.id,
        fromStatus: null,
        toStatus: RideStatus.DRAFT,
        changedByUserId: vikram.id,
        reason: 'Ride created',
      },
      {
        rideId: confirmedRide.id,
        fromStatus: RideStatus.DRAFT,
        toStatus: RideStatus.PUBLISHED,
        changedByUserId: vikram.id,
        reason: 'Creator published the ride',
      },
      {
        rideId: confirmedRide.id,
        fromStatus: RideStatus.PUBLISHED,
        toStatus: RideStatus.CONFIRMED,
        changedByUserId: vikram.id,
        reason: 'First request accepted',
      },
    ],
  });
  const meeraRequestOnConfirmed = await prisma.rideRequest.create({
    data: {
      rideId: confirmedRide.id,
      userId: meera.id,
      requestedSeats: 1,
      status: 'ACCEPTED',
      resolvedAt: new Date(),
    },
  });
  await prisma.rideParticipant.create({
    data: {
      rideId: confirmedRide.id,
      userId: meera.id,
      requestId: meeraRequestOnConfirmed.id,
      seatsAllocated: 1,
      status: 'CONFIRMED',
    },
  });
  const harshaRequestOnConfirmed = await prisma.rideRequest.create({
    data: {
      rideId: confirmedRide.id,
      userId: harsha.id,
      requestedSeats: 2,
      status: 'PENDING',
    },
  });
  await prisma.notification.createMany({
    data: [
      {
        userId: meera.id,
        type: 'REQUEST_ACCEPTED',
        title: 'Request accepted',
        body: 'Vikram accepted your request to join the ride to MG Road.',
        rideId: confirmedRide.id,
        requestId: meeraRequestOnConfirmed.id,
      },
      {
        userId: vikram.id,
        type: 'RIDE_CONFIRMED',
        title: 'Ride confirmed',
        body: 'Your ride to MG Road now has a confirmed participant.',
        rideId: confirmedRide.id,
      },
      {
        userId: vikram.id,
        type: 'RIDE_REQUESTED',
        title: 'New ride request',
        body: `${harsha.name} requested to join your ride to MG Road.`,
        rideId: confirmedRide.id,
        requestId: harshaRequestOnConfirmed.id,
      },
    ],
  });

  // 4. IN_PROGRESS — underway; no new requests accepted.
  const inProgressRide = await prisma.ride.create({
    data: {
      creatorId: vikram.id,
      pickupLocationId: hsrLayout.id,
      destinationLocationId: whitefield.id,
      departureDateTime: new Date(Date.now() - HOUR_MS),
      totalSeats: 3,
      vehicleType: 'car',
      discoveryRadiusKm: 7,
      pricingType: PricingType.STANDARD,
      pricePerKm: 4,
      estimatedDistanceKm: 15,
      estimatedContribution: 60,
      status: RideStatus.IN_PROGRESS,
    },
  });
  await prisma.rideStatusHistory.createMany({
    data: [
      {
        rideId: inProgressRide.id,
        fromStatus: null,
        toStatus: RideStatus.DRAFT,
        changedByUserId: vikram.id,
        reason: 'Ride created',
      },
      {
        rideId: inProgressRide.id,
        fromStatus: RideStatus.DRAFT,
        toStatus: RideStatus.PUBLISHED,
        changedByUserId: vikram.id,
        reason: 'Creator published the ride',
      },
      {
        rideId: inProgressRide.id,
        fromStatus: RideStatus.PUBLISHED,
        toStatus: RideStatus.CONFIRMED,
        changedByUserId: vikram.id,
        reason: 'First request accepted',
      },
      {
        rideId: inProgressRide.id,
        fromStatus: RideStatus.CONFIRMED,
        toStatus: RideStatus.IN_PROGRESS,
        changedByUserId: vikram.id,
        reason: 'Creator started the ride',
      },
    ],
  });
  const arjunRequestOnInProgress = await prisma.rideRequest.create({
    data: {
      rideId: inProgressRide.id,
      userId: arjun.id,
      requestedSeats: 1,
      status: 'ACCEPTED',
      resolvedAt: new Date(Date.now() - 2 * HOUR_MS),
    },
  });
  await prisma.rideParticipant.create({
    data: {
      rideId: inProgressRide.id,
      userId: arjun.id,
      requestId: arjunRequestOnInProgress.id,
      seatsAllocated: 1,
      status: 'CONFIRMED',
    },
  });
  await prisma.notification.create({
    data: {
      userId: arjun.id,
      type: 'RIDE_STARTED',
      title: 'Ride started',
      body: 'Your ride to Whitefield has started.',
      rideId: inProgressRide.id,
    },
  });

  // 5. COMPLETED — terminal state; appears in history for creator and
  // confirmed participants.
  const completedRide = await prisma.ride.create({
    data: {
      creatorId: vikram.id,
      pickupLocationId: electronicCity.id,
      destinationLocationId: indiranagar.id,
      departureDateTime: new Date(Date.now() - 2 * DAY_MS),
      totalSeats: 2,
      vehicleType: 'car',
      discoveryRadiusKm: 8,
      pricingType: PricingType.STANDARD,
      pricePerKm: 4,
      estimatedDistanceKm: 18.4,
      estimatedContribution: 73.6,
      status: RideStatus.COMPLETED,
    },
  });
  await prisma.rideStatusHistory.createMany({
    data: [
      {
        rideId: completedRide.id,
        fromStatus: null,
        toStatus: RideStatus.DRAFT,
        changedByUserId: vikram.id,
        reason: 'Ride created',
      },
      {
        rideId: completedRide.id,
        fromStatus: RideStatus.DRAFT,
        toStatus: RideStatus.PUBLISHED,
        changedByUserId: vikram.id,
        reason: 'Creator published the ride',
      },
      {
        rideId: completedRide.id,
        fromStatus: RideStatus.PUBLISHED,
        toStatus: RideStatus.CONFIRMED,
        changedByUserId: vikram.id,
        reason: 'First request accepted',
      },
      {
        rideId: completedRide.id,
        fromStatus: RideStatus.CONFIRMED,
        toStatus: RideStatus.IN_PROGRESS,
        changedByUserId: vikram.id,
        reason: 'Creator started the ride',
      },
      {
        rideId: completedRide.id,
        fromStatus: RideStatus.IN_PROGRESS,
        toStatus: RideStatus.COMPLETED,
        changedByUserId: vikram.id,
        reason: 'Creator marked the ride complete',
      },
    ],
  });
  const meeraRequestOnCompleted = await prisma.rideRequest.create({
    data: {
      rideId: completedRide.id,
      userId: meera.id,
      requestedSeats: 1,
      status: 'ACCEPTED',
      resolvedAt: new Date(Date.now() - 2 * DAY_MS - HOUR_MS),
    },
  });
  await prisma.rideParticipant.create({
    data: {
      rideId: completedRide.id,
      userId: meera.id,
      requestId: meeraRequestOnCompleted.id,
      seatsAllocated: 1,
      status: 'CONFIRMED',
    },
  });
  await prisma.notification.createMany({
    data: [
      {
        userId: vikram.id,
        type: 'RIDE_COMPLETED',
        title: 'Ride completed',
        body: 'Your ride to Indiranagar is complete.',
        rideId: completedRide.id,
        readAt: new Date(),
      },
      {
        userId: meera.id,
        type: 'RIDE_COMPLETED',
        title: 'Ride completed',
        body: 'Your ride to Indiranagar is complete.',
        rideId: completedRide.id,
      },
    ],
  });

  // 6. CANCELLED — creator cancelled a PUBLISHED ride; pending request
  // cascades to CANCELLED.
  const cancelledRide = await prisma.ride.create({
    data: {
      creatorId: riya.id,
      pickupLocationId: whitefield.id,
      destinationLocationId: koramangala.id,
      departureDateTime: daysFromNow(4),
      totalSeats: 3,
      vehicleType: 'car',
      discoveryRadiusKm: 9,
      pricingType: PricingType.CUSTOM,
      pricePerKm: 3,
      estimatedDistanceKm: 10,
      estimatedContribution: 30,
      status: RideStatus.CANCELLED,
    },
  });
  await prisma.rideStatusHistory.createMany({
    data: [
      {
        rideId: cancelledRide.id,
        fromStatus: null,
        toStatus: RideStatus.DRAFT,
        changedByUserId: riya.id,
        reason: 'Ride created',
      },
      {
        rideId: cancelledRide.id,
        fromStatus: RideStatus.DRAFT,
        toStatus: RideStatus.PUBLISHED,
        changedByUserId: riya.id,
        reason: 'Creator published the ride',
      },
      {
        rideId: cancelledRide.id,
        fromStatus: RideStatus.PUBLISHED,
        toStatus: RideStatus.CANCELLED,
        changedByUserId: riya.id,
        reason: 'Creator cancelled the ride',
      },
    ],
  });
  const harshaRequestOnCancelled = await prisma.rideRequest.create({
    data: {
      rideId: cancelledRide.id,
      userId: harsha.id,
      requestedSeats: 1,
      status: 'CANCELLED',
      resolvedAt: new Date(),
    },
  });
  await prisma.notification.createMany({
    data: [
      {
        userId: harsha.id,
        type: 'REQUEST_CANCELLED',
        title: 'Request cancelled',
        body: 'The ride to Koramangala was cancelled by the creator.',
        rideId: cancelledRide.id,
        requestId: harshaRequestOnCancelled.id,
      },
      {
        userId: riya.id,
        type: 'RIDE_CANCELLED',
        title: 'Ride cancelled',
        body: 'You cancelled your ride to Koramangala.',
        rideId: cancelledRide.id,
      },
    ],
  });

  // 7. EXPIRED — published ride whose departure passed without starting;
  // an earlier request was rejected before expiry.
  const expiredRide = await prisma.ride.create({
    data: {
      creatorId: riya.id,
      pickupLocationId: mgRoad.id,
      destinationLocationId: marathahalli.id,
      departureDateTime: new Date(Date.now() - DAY_MS),
      totalSeats: 2,
      vehicleType: 'car',
      discoveryRadiusKm: 6,
      pricingType: PricingType.STANDARD,
      pricePerKm: 4,
      estimatedDistanceKm: 7.2,
      estimatedContribution: 28.8,
      status: RideStatus.EXPIRED,
    },
  });
  await prisma.rideStatusHistory.createMany({
    data: [
      {
        rideId: expiredRide.id,
        fromStatus: null,
        toStatus: RideStatus.DRAFT,
        changedByUserId: riya.id,
        reason: 'Ride created',
      },
      {
        rideId: expiredRide.id,
        fromStatus: RideStatus.DRAFT,
        toStatus: RideStatus.PUBLISHED,
        changedByUserId: riya.id,
        reason: 'Creator published the ride',
      },
      {
        rideId: expiredRide.id,
        fromStatus: RideStatus.PUBLISHED,
        toStatus: RideStatus.EXPIRED,
        changedByUserId: null,
        reason: 'Departure time passed without the ride starting',
      },
    ],
  });
  const arjunRequestOnExpired = await prisma.rideRequest.create({
    data: {
      rideId: expiredRide.id,
      userId: arjun.id,
      requestedSeats: 1,
      status: 'REJECTED',
      resolvedAt: new Date(Date.now() - 1.5 * DAY_MS),
    },
  });
  await prisma.notification.createMany({
    data: [
      {
        userId: arjun.id,
        type: 'REQUEST_REJECTED',
        title: 'Request rejected',
        body: 'Riya rejected your request to join the ride to Marathahalli.',
        rideId: expiredRide.id,
        requestId: arjunRequestOnExpired.id,
      },
      {
        userId: riya.id,
        type: 'RIDE_EXPIRED',
        title: 'Ride expired',
        body: 'Your ride to Marathahalli expired without starting.',
        rideId: expiredRide.id,
      },
    ],
  });

  console.log('[seed] Done. Summary:');
  console.log(`[seed]   Users: 5`);
  console.log(`[seed]   Locations: 7`);
  console.log(
    `[seed]   Rides: 7 (one per status: DRAFT, PUBLISHED, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED, EXPIRED)`,
  );
  console.log(
    '[seed] This is DEVELOPMENT seed data only — not production data.',
  );
}

main()
  .catch((err) => {
    console.error('[seed] Failed:', err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
