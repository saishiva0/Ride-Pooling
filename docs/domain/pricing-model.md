# RidePool — Pricing Model

> Status: Phase 0 — Domain Definition
> Owner: Product / Tech Lead

## 1. Purpose

Pricing is a first-class Ride Engine requirement. It supports transparent cost
sharing between creators and participants. It is **not** commercial fare
generation.

## 2. Pricing Options

The creator chooses one of two options when creating a ride.

### Option A — Standard / Recommended Price

- RidePool provides a recommended standard price per km.
- Reference value for the initial carpool model: **₹4/km**.
- Presented as a recommended cost-sharing rate, **not** a mandatory fare.

### Option B — Custom Price

- The creator may select a different price per km within an approved range.
- Initial proposed range: **₹2/km to ₹6/km**.
- The system validates the selected value. Arbitrary/unlimited pricing is not
  allowed.

> Final rates and ranges may be adjusted after product validation and
> market/legal review. Values are **configurable**, never hardcoded throughout
> the codebase.

## 3. Pricing Terminology

| Preferred              | Avoid           |
| ---------------------- | --------------- |
| Price per km           | Taxi fare       |
| Estimated contribution | Driver fare     |
| Recommended rate       | Commercial fare |
| Cost sharing           | —               |

The participant must see the expected contribution **before** submitting a join
request.

## 4. Pricing Calculation (Conceptual)

```
Estimated Contribution = Estimated Ride Distance × Selected Price Per Km
```

Example:

```
Distance = 15 km
Price    = ₹4/km
Estimated contribution = ₹60
```

Assumptions:

- Distance is the estimated route distance between pickup and destination.
- Actual implementation will account for the application's distance
  calculation rules (see OD-007 map/distance provider).
- Rounding policy for display (e.g., nearest ₹) = **PRODUCT DECISION REQUIRED**
  (OD-018).

## 5. Pricing Data Requirements (Domain)

The Ride domain conceptually supports:

| Field                   | Type (conceptual) | Notes                                   |
| ----------------------- | ----------------- | --------------------------------------- |
| `pricingType`           | enum              | `STANDARD` \| `CUSTOM`                  |
| `pricePerKm`            | number (₹)        | `₹4` for standard; validated for custom |
| `estimatedDistanceKm`   | number            | computed from route                     |
| `estimatedContribution` | number (₹)        | derived: distance × price/km            |

Pricing type supports at minimum: `STANDARD`, `CUSTOM`.

> No database schema is defined in this phase.

## 6. Validation Rules

- `pricePerKm` must be present and finite.
- For `STANDARD`: value equals the configured recommended rate.
- For `CUSTOM`: value within configured min/max (₹2–₹6 initial).
- `estimatedContribution` recomputed whenever distance or price changes.
- Price fields are immutable once the ride is `PUBLISHED` (changes require
  creator edit rules; see OD-012).

## 7. Configuration Requirement

Rates and ranges are configuration, not code:

```
pricingConfig = {
  standardPricePerKm: 4,
  customPricePerKm: { min: 2, max: 6 },
  currency: "INR"
}
```

This allows post-validation adjustment without redeploys of business logic.

## 8. Non-Goals (V1)

- No dynamic/surge pricing.
- No platform commission.
- No per-ride service fee.
- No payment of any kind.
- No fare estimation by the platform beyond distance × price.

## 9. Document Map

| Related doc                            | Purpose                                 |
| -------------------------------------- | --------------------------------------- |
| `docs/product/product-requirements.md` | PRD §11 pricing                         |
| `docs/domain/ride-engine.md`           | Engine pricing responsibility           |
| `docs/domain/domain-model.md`          | Pricing fields on Ride entity           |
| `docs/planning/open-decisions.md`      | OD-006 exact ranges, OD-012 price edits |
