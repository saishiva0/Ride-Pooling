# RidePool — Product Requirements

> Canonical product requirements. See linked domain, architecture, and planning documents for detailed contracts.

<!-- Existing document content remains unchanged except for the notification-provider status below. -->

Full spec: `docs/domain/domain-model.md` (Location) and
`docs/domain/matching-model.md`.

- Latitude/longitude for pickup, destination, and user current location.
- Search radius; distance calculation; route compatibility.
- Separate **User Location** from **Ride Location**.
- No continuous background tracking assumption; permission-gated and minimal.

## 14. Notifications Requirements

- Ride request, accepted, rejected, reminder, cancellation, state changes.
- Delivered in-app (real-time) at minimum; push delivery uses **Expo Notifications / Expo Push Service**, resolved by OD-008 in Phase 3.23.

## 15. Safety Requirements

- Reporting and blocking (V1 baseline).
- Cancellation controls and clear rules.
- User safety info on profile.
- Basic verification (degree of verification = open decision OD-010).
- Abuse prevention (rate limiting, duplicate prevention).
