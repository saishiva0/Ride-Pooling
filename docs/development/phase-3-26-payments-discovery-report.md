# Phase 3.26 — Payments Discovery Report

> Status: **BLOCKED / NOT APPLICABLE TO V1** — discovery only. No payment implementation is authorized by the current canonical product and architecture decisions.

## 1. Scope investigated

Phase 3.25 implementation notes identify Phase 3.26 as Payments. This discovery pass checked the canonical product, architecture, planning, legal, pricing, and roadmap documents before any implementation work.

## 2. Canonical decisions

### ADR-006 — No payment processing in V1

`docs/architecture/technical-decisions.md` explicitly states:

- No payments, wallets, or payouts in V1.
- Contribution may be displayed transparently but is not collected by the platform.
- Payment processing is a future phase.

This is an accepted architecture decision, not an implementation detail.

### V1 product scope

`docs/product/v1-scope.md` states that V1 has no payment processing and no platform commission. The product model remains cost sharing / estimated contribution rather than a collected fare.

### Legal / regulatory boundary

`docs/planning/legal-regulatory-note.md` states that V1 has no payments and no platform commission, and that the cost-sharing model, platform role, tax/accounting treatment, consumer protection, and related regulatory questions require qualified review before public commercial launch.

### Open decisions

The current open-decision register does not contain an approved payment-provider or payment-processing decision. Existing open items that materially affect payment adoption include regulatory/geography and pricing decisions (OD-006, OD-016, OD-017), while ADR-006 already excludes payment processing from V1.

## 3. Existing payment-related implementation

No payment module, payment provider integration, wallet, payout, transaction ledger, webhook handling, payment intent model, refund flow, or payment API was found as an approved V1 capability.

The existing pricing/contribution logic is display/business-rule functionality only. It does not authorize collection or settlement.

## 4. Missing product decisions

Before any payment implementation can safely begin, the product owner would need to explicitly decide at minimum:

1. Whether payment processing is V1.1 or a later phase.
2. Whether RidePool collects money or only facilitates peer settlement.
3. Who pays whom and at what lifecycle point.
4. Whether the platform ever holds funds.
5. Refund/cancellation semantics.
6. Payment failure semantics relative to ride state.
7. Dispute/chargeback handling.
8. Tax/accounting treatment.
9. Applicable regulatory requirements for the launch jurisdiction.
10. Platform liability and consumer-protection requirements.
11. Supported payment methods and currencies.
12. Provider selection and vendor-cost approval.
13. Webhook/authentication/idempotency contract.
14. Payment transaction/ledger data model and retention.
15. Payout/settlement model, if applicable.
16. Required mobile/backend UX and API surface.
17. Security/PCI scope and secret-handling requirements.
18. Acceptance criteria and operational reconciliation requirements.

## 5. Why implementation must stop

Implementing payments now would require inventing a financial product, legal posture, settlement model, provider, data model, failure semantics, and compliance boundary that the repository has deliberately left for a future phase.

The accepted ADR-006 decision directly conflicts with introducing payment processing into V1. The legal/regulatory note also requires review before commercial launch and does not authorize a payment implementation.

Therefore this discovery does **not** create application code, schema changes, migrations, dependencies, payment-provider configuration, APIs, or mobile payment UI.

## 6. Recommended outcome

1. Keep payment processing out of V1.
2. Treat Phase 3.26 as **deferred / post-V1** until product and legal/business decisions explicitly authorize it.
3. Do not select a payment provider during implementation discovery.
4. Keep existing contribution/pricing behavior unchanged.
5. Revisit payments only after the required product, regulatory, accounting, and provider decisions are recorded canonically.

## 7. Relationship to adjacent phases

- **Phase 3.25:** Ride Chat V1.1 — implemented and merged.
- **Phase 3.26:** Payments — blocked/deferred by current canonical decisions.
- **Phase 3.27:** Offline & Reliability — previously discovered as post-V1 / not applicable to V1; no implementation should start without new canonical scope.
- **OD-010:** Identity verification remains a separate unresolved decision and is not resolved by this payment discovery.
- **OD-013:** Data retention remains a separate unresolved decision.

## 8. Changes made by this discovery

Only this discovery report was added. No application code, Prisma schema, migration, dependency, configuration, or product decision was changed.
