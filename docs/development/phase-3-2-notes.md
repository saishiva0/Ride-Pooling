# Phase 3.2 — Ride Creation: Implementation Notes

> Status: Phase 3.2 — Implementation
> Records how Ride Creation was built on top of Phase 2 (persistence) and
> Phase 3.1 (ride domain core), and any implementation-level decisions made
> along the way. Phase 0/1 documents remain the source of truth; this note
> does not change product/domain decisions.

## 1. Traceability

| Phase 0/1/2 requirement                                              | Implementation                                                                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/domain/ride-engine.md` §4.1 Ride Creation                      | `RideCreationInput` → domain validation → transactional persistence → created Ride                                                          |
| `docs/domain/ride-engine.md` §4.1 "Output: ride in DRAFT"            | `INITIAL_RIDE_STATUS = DRAFT` (constant in `ride.repository.ts`)                                                                            |
| `docs/domain/ride-lifecycle.md` §2.1 DRAFT                           | Initial `RideStatusHistory` row: `fromStatus: null` → `toStatus: DRAFT`, `changedByUserId` = creator                                        |
| `docs/domain/ride-engine.md` §6, `docs/development/phase-2-notes.md` | Creator lookup inside the `$transaction`; `NotFoundError` rolls back — no partial Ride/history/locations                                    |
| `docs/domain/pricing-model.md` §2/§6                                 | Reused `RIDE_PRICING_CONFIG` from Phase 3.1 (STANDARD ₹4/km, CUSTOM ₹2–₹6/km). No new values                                                |
| `docs/domain/pricing-model.md` §4                                    | No contribution calculation here: `estimatedDistanceKm`/`estimatedContribution` pass through when supplied (map/distance provider = OD-007) |
| `docs/domain/ride-engine.md` §4.2, Phase 3.1                         | Field validation via `assertValidRideFields()` (reused, not duplicated)                                                                     |
| `docs/domain/domain-model.md` §2.5                                   | `RideStatusHistory` written in the same transaction as the Ride                                                                             |
| `docs/architecture/api-boundaries.md` §4                             | Application errors use the existing `AppError` hierarchy (`lib/errors.ts`); no new error architecture                                       |

## 2. Implementation clarifications (not new product decisions)

1. **Initial state is `DRAFT`, and publication is not part of creation.**
   `docs/domain/ride-lifecycle.md` §2.1 and `docs/domain/ride-engine.md` §4.1
   both define creation as producing a `DRAFT` ride; `DRAFT → PUBLISHED` is a
   separate later operation. Ride creation therefore records the initial
   history row `null → DRAFT` only.
2. **Creator validation lives inside the transaction.** The creator lookup is
   the first step of the `$transaction` in `persistNewRide`, so a missing
   creator fails atomically with the rest of the writes (no pre-transaction
   read-then-write gap). This is also the only sane place while there is no
   user repository (Phase 2 left User persistence without an access layer).
3. **Distance/contribution are pass-through, not computed.** No routing or
   distance provider exists (OD-007). When the caller supplies
   `estimatedDistanceKm`/`estimatedContribution`, the application validates
   they are finite and non-negative and persists them as submitted; when
   absent, they remain `NULL`. No value is invented.
4. **Input-shape checks stay in the application layer.** `create-ride.ts`
   checks fields the domain layer does not own (presence of `creatorId`,
   valid `Date`, positive `discoveryRadiusKm`, non-negative supplied
   distance/contribution). Ride field rules (seats, coordinates, pricing,
   origin ≠ destination) are owned by Phase 3.1 and are not duplicated.
5. **`location` label is optional.** The `Location` schema allows a nullable
   `label`; creation passes it through when provided.
6. **Seed data is unchanged.** Phase 3.2 ride-creation tests build their own
   fixtures and clean up after themselves; the deterministic Phase 2 seed is
   untouched.

## 3. Transaction design

`persistNewRide` uses a single `client.$transaction`:

```
1. lookup creator (User)      → missing → NotFoundError (rollback)
2. create pickup Location
3. create destination Location
4. create Ride (status = DRAFT)
5. create initial RideStatusHistory (null → DRAFT, changedByUserId = creator)
```

All writes commit or roll back together. The integration test forces a real
Postgres CHECK-constraint failure after the pickup-Location write to prove a
genuine mid-transaction rollback (no orphaned Location, Ride, or history).

## 4. Explicitly out of scope for Phase 3.2 (confirmed)

No HTTP API/controllers/routes, no authentication/authorization, no ride
discovery or spatial search, no matching, no RideRequest, no accept/reject,
no RideParticipant management, no notifications, no Socket.io, no payments,
no chat, no maps/distance provider, and no mobile UI. No Prisma schema or
migration changes were made — the Phase 2 schema was used as-is.
