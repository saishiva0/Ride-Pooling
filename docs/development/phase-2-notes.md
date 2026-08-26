# Phase 2 — Domain Model & Database: Implementation Notes

> Status: Phase 2 — Implementation
> Records how the approved Phase 0 domain model was translated into the
> Prisma schema and database migration, and any implementation-level
> clarifications made along the way. Phase 0 documents remain the source of
> truth; this note does not change product/domain decisions.

## 1. Traceability

| Phase 0 concept                                      | Prisma model / field                                                                               | Migration detail                                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/domain/domain-model.md` §2.1 User              | `User`                                                                                             | Standard table; no auth credentials (OD-005 open)                                                                                       |
| `docs/domain/domain-model.md` §2.6 Location          | `Location`                                                                                         | `latitude`/`longitude` (Decimal) + generated PostGIS `point` (custom SQL)                                                               |
| `docs/domain/domain-model.md` §2.2 Ride              | `Ride`                                                                                             | Includes pricing fields, `status` (`RideStatus` enum), FKs to creator/locations                                                         |
| `docs/domain/domain-model.md` §2.3 RideRequest       | `RideRequest`                                                                                      | Partial unique index prevents duplicate active requests (custom SQL)                                                                    |
| `docs/domain/domain-model.md` §2.4 RideParticipant   | `RideParticipant`                                                                                  | `requestId` unique; partial unique index prevents duplicate CONFIRMED rows                                                              |
| `docs/domain/domain-model.md` §2.5 RideStatusHistory | `RideStatusHistory`                                                                                | Append-only; `fromStatus` nullable for the initial DRAFT entry                                                                          |
| `docs/domain/domain-model.md` §2.7 Notification      | `Notification`                                                                                     | `type` enum mirrors `docs/architecture/event-model.md` §2.1 event catalogue                                                             |
| `docs/domain/ride-lifecycle.md` §1 (7 states)        | `RideStatus` enum                                                                                  | Exactly 7 values; `REQUESTED` intentionally excluded per the lifecycle review                                                           |
| `docs/domain/ride-lifecycle.md` §6 Request states    | `RideRequestStatus` enum                                                                           | `PENDING`, `ACCEPTED`, `REJECTED`, `CANCELLED`                                                                                          |
| `docs/domain/pricing-model.md` §2, §5                | `Ride.pricingType`, `pricePerKm`, `estimatedDistanceKm`, `estimatedContribution`                   | Values preserved as submitted; range/standard-rate validation deferred to the Ride Engine (Phase 3), not hardcoded in the database      |
| `docs/domain/matching-model.md` §8 Geospatial index  | `Location.point` + GiST index                                                                      | Infrastructure only — no matching/discovery queries implemented                                                                         |
| `docs/domain/ride-engine.md` §5 Invariants           | CHECK constraints (seats ≥ 1, price > 0, non-negative distance/contribution, pickup ≠ destination) | Universal sanity bounds only; configured thresholds (OD-003/OD-004/OD-006) are NOT hardcoded                                            |
| `docs/domain/ride-engine.md` §6 Concurrency risks    | Partial unique indexes (`RideRequest`, `RideParticipant`)                                          | Prevents duplicate-request and duplicate-confirmed-participation races at the DB layer; transactional seat allocation itself is Phase 3 |

## 2. Implementation clarifications (not new product decisions)

These are inferences needed to translate the conceptual domain model into a
concrete schema. None of them resolve an open decision (OD-001…OD-019); they
are the smallest reversible choices needed to build a working schema.

1. **User contact requirement enforced at the DB layer.** The domain model
   lists "phone/email" as an important field without specifying a database
   constraint. A `CHECK (phone IS NOT NULL OR email IS NOT NULL)` constraint
   was added so a user always has at least one contact method. This does not
   decide _which_ method is required (that's OD-005/auth) — either or both
   may be present.
2. **Pickup ≠ destination enforced at the DB layer.** `docs/domain/ride-engine.md`
   §4.2 lists this as a validation rule; it was promoted to a `CHECK`
   constraint on `Ride` in addition to being a future Ride Engine validation,
   since it is a structural invariant that never changes with configuration.
3. **No CHECK constraint for the ₹2–6/km custom price range or the ₹4/km
   standard rate.** Per `docs/domain/pricing-model.md` §7, pricing values are
   configuration, not hardcoded code/schema. Only a universal
   `pricePerKm > 0` sanity check was added at the database layer; range and
   standard-rate validation is Ride Engine business logic (Phase 3),
   config-driven.
4. **PostGIS extension version pinned to the exact installed version
   (`3.6.2`)**, not a minor-version wildcard, because PostgreSQL's
   `CREATE EXTENSION ... WITH VERSION` requires an exact installed version
   match. This is a technical/environmental necessity, not a domain
   decision.
5. **Generated spatial column, not application-computed.** `Location.point`
   is a PostgreSQL `GENERATED ALWAYS AS (...) STORED` column so it can never
   drift from `latitude`/`longitude`, and no application code is responsible
   for keeping it in sync.

## 3. Open decisions — explicitly NOT resolved here

No items from `docs/planning/open-decisions.md` (OD-001…OD-019) were
resolved by this phase. In particular:

- Authentication method (OD-005) — the `User` model has no credential fields.
- Exact vehicle types (OD-001/OD-003) — `Ride.vehicleType` is a free-form
  optional string, not an enum, so no vehicle list is committed.
- Matching thresholds (OD-004) — `Ride.discoveryRadiusKm` is stored as
  submitted; no default/threshold logic exists.
- Final pricing range/rate (OD-006) — `₹4` standard and `₹2–6` custom are
  used only in seed data and comments, matching the Phase 0 reference
  values; nothing is hardcoded as a constraint.
- Cancellation/expiration grace windows (OD-002), participant cancellation
  during `IN_PROGRESS` (OD-011), ride edit rules (OD-012), and seat
  reservation policy (OD-019) — none of these are enforced by the schema;
  they belong to the Ride Engine state machine (Phase 3).

## 4. Explicitly out of scope for Phase 2 (confirmed)

No Ride Engine business logic was implemented: no ride creation/validation
service, no discovery/matching queries, no request accept/reject logic, no
lifecycle state machine, no pricing calculation service, no authentication,
no notification delivery, no Socket.io events, no map integration, no chat,
no payments, and no product UI. This phase is the persistence layer only.
