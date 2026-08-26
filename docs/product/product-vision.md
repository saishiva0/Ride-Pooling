# RidePool — Product Vision

> Status: Phase 0 — Product Definition (documentation only)
> Owner: Product / Tech Lead

## 1. Core Idea

People who are already travelling in a particular direction can share their
available capacity with other people travelling along a compatible route.

RidePool is a **technology platform that connects people**. It does not own
vehicles, operate a fleet, or employ drivers.

## 2. Value Proposition

> **"Connect people already going the same way."**

## 3. What RidePool Helps Users Do

RidePool helps users:

1. **CREATE** — a ride from their existing journey
2. **DISCOVER** — rides going their way
3. **MATCH** — find route/time/capacity compatibility
4. **REQUEST** — to join an available ride
5. **ACCEPT** — the creator approves compatible participants
6. **RIDE** — travel together
7. **COMPLETE** — finish and see the journey in history

## 4. What RidePool Is NOT

- Not a traditional taxi or fleet-management application.
- Not a commercial transportation marketplace where drivers earn fares.
- Not a vehicle-ownership platform.
- Not a payment processor (in V1).

## 5. The Two Core User Types

1. **Ride Creator** — someone already travelling somewhere with available
   capacity, who publishes the journey so others can join.
2. **Ride Participant** — someone travelling in a compatible direction who
   joins an available ride.

Terminology note: "Creator" and "Participant" describe product behaviour, not
legal classification (see `docs/planning/legal-regulatory-note.md`).

## 6. Product Principles

| #   | Principle                        | Meaning                                                                                      |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | **Simplicity**                   | Create or find a ride with minimal effort.                                                   |
| 2   | **Transparency**                 | Route, time, seats, distance, price/km, estimated contribution, and status are always clear. |
| 3   | **Cost sharing**                 | RidePool enables reasonable ride cost sharing, not arbitrary commercial fares.               |
| 4   | **No platform commission in V1** | No commission added to creators or participants in V1.                                       |
| 5   | **Mobile first**                 | The primary experience is a mobile application.                                              |
| 6   | **Location aware**               | Discovery and matching depend on proximity and route compatibility.                          |
| 7   | **Deterministic first**          | V1 matching uses deterministic business rules, not AI/ML.                                    |
| 8   | **Privacy by design**            | Location and personal data handled carefully; no continuous background tracking assumption.  |

## 7. Problem Statement

In everyday travel — commutes, intercity trips, college runs — a large share of
vehicles travel with unused seats. There is no lightweight, mobile-first way for
two ordinary people going the same way to discover each other, agree to share
the journey, and transparently share the cost.

Existing options are either:

- commercial ride-hailing (expensive, driver-centric), or
- informal arrangements (no trust, no discovery, no structure).

RidePool fills the gap: a simple, transparent, low-friction platform for
connecting people already going the same way.

## 8. North-Star Metric

**Completed Shared Rides ÷ Published Rides**

This measures whether published rides actually convert into completed shared
journeys — the core marketplace behaviour. See
`docs/product/product-requirements.md` § Success Metrics.

## 9. Related Documents

- `docs/product/product-requirements.md`
- `docs/product/user-personas.md`
- `docs/product/user-flows.md`
- `docs/product/v1-scope.md`
- `docs/domain/ride-engine.md`
