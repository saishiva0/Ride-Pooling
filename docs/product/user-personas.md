# RidePool — User Personas

> Status: Phase 0 — Product Definition
> These are product personas for design. Roles are defined in
> `docs/product/product-vision.md`.

## Role Model (Not Personas)

RidePool has two functional roles. These are **behavioural roles**, not legal
classifications.

| Role                 | Definition                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------ |
| **Ride Creator**     | A user who creates a ride because they are already travelling and have available capacity. |
| **Ride Participant** | A user who discovers a compatible ride and requests to join it.                            |

Any single user can act as a Creator on one day and a Participant on another.
The system does not create permanent roles such as "Driver", "Passenger", or
"Fleet Owner" in V1.

> **Terminology does not determine legal classification.** See
> `docs/planning/legal-regulatory-note.md`.

---

## Persona 1 — Riya, the Commuter Creator

- **Age / profile:** 29, software engineer in Bengaluru.
- **Context:** Drives her own car daily from Whitefield to Koramangala.
- **Goal:** Recover a little of her fuel cost and enjoy company on the commute.
- **Frustrations:** Parking and fuel costs; empty seats every single day.
- **Behaviour with RidePool:**
  - Creates a commute ride once, reuses it on weekdays.
  - Sets a standard price per km (recommended rate).
  - Accepts requests from people whose pickup and destination are on her route.
  - Cares that contributions are transparent and that she is not treated as a
    commercial driver.
- **What matters most:** Minimal setup effort, clear cost sharing, control over
  who joins.

## Persona 2 — Arjun, the Discovery Participant

- **Age / profile:** 24, graduate student.
- **Context:** Travels from his PG to campus most mornings; does not own a car.
- **Goal:** Get to campus reliably and cheaply without public transport hassle.
- **Frustrations:** Unpredictable buses, high cab fares for a short trip.
- **Behaviour with RidePool:**
  - Opens the app, discovers nearby rides going to campus.
  - Filters by departure time and price.
  - Sees the estimated contribution before requesting.
  - Requests to join; watches request status; gets notified on acceptance.
- **What matters most:** Honest estimated cost, reliable acceptance flow, clear
  status, and simple ride details.

## Persona 3 — Meera, the Occasional Intercity Traveller

- **Age / profile:** 31, product manager.
- **Context:** Travels Bengaluru → Mysuru every other weekend.
- **Goal:** Occasional intercity ride sharing to reduce cost and drive alone less.
- **Behaviour with RidePool:**
  - Creates a weekend ride occasionally; may also join others' rides.
  - Appreciates transparent pricing and the option of a custom price within the
    allowed range.
  - Uses safety basics (profile info, reports) before committing.
- **What matters most:** Transparency, safety signals, and no surprising fees.

## Persona 4 — Harsha, the Cautious First-Time Participant

- **Age / profile:** 22, intern.
- **Context:** Nervous about ride sharing with strangers.
- **Goal:** Try ride sharing safely once.
- **Behaviour with RidePool:**
  - Reads ride details carefully: creator info, vehicle, seats, price.
  - Only requests rides where pricing and route are clear.
  - Relies on clear status messages and cancellation rules.
  - Would want an easy way to report a problem (V1 baseline).
- **What matters most:** Clear expectations, privacy of location, and simple
  safety controls.

## Persona 5 — Vikram, the Reliability-Focused Creator

- **Age / profile:** 35, consultant.
- **Context:** Daily fixed-time commute; dislikes ambiguity.
- **Goal:** A dependable ride with predictable participants.
- **Behaviour with RidePool:**
  - Sets precise date/time, seats, and custom price within range.
  - Reviews requests before accepting; rejects mismatched ones.
  - Wants the ride lifecycle to be deterministic (publish → confirm → start →
    complete).
- **What matters most:** Clear ride state, deterministic transitions, and no
  overbooking.

---

## Persona → Role Mapping

| Persona | Primary role             |
| ------- | ------------------------ |
| Riya    | Ride Creator             |
| Arjun   | Ride Participant         |
| Meera   | Both (context-dependent) |
| Harsha  | Ride Participant         |
| Vikram  | Ride Creator             |

## What Personas Imply for V1

- Ride creation must be minimal-effort (Riya, Vikram).
- Discovery + request must be fast and transparent (Arjun, Harsha).
- Pricing must be clear and within limits (all).
- Lifecycle must be deterministic and overbooking must be impossible (Vikram).
- Safety baseline: profile, reports, clear status (Harsha, Meera).
