# RidePool — Cost / Vendor Review

> Status: Phase 0 — Planning
> Identifies future variable-cost services. **No vendors are selected in this
> phase.** Priorities: low cost, low maintenance, OSS-first.

## 1. Principles

- Prefer free/open-source tooling where practical.
- Minimize paid APIs, infrastructure, third-party SaaS, and operational
  complexity.
- Two-person team with a limited initial budget.

## 2. COST / VENDOR REVIEW REQUIRED

Services that may create variable costs (review before adoption):

| Service                       | Cost risk         | Decision / Open item                       |
| ----------------------------- | ----------------- | ------------------------------------------ |
| Maps                          | Usage-based       | Provider choice = OD-007                   |
| Geocoding / reverse geocoding | Usage-based       | Part of OD-007                             |
| Distance / routing            | Usage-based       | Part of OD-007                             |
| Push notifications            | Per-message tiers | OD-008                                     |
| SMS / OTP                     | Per-message       | OD-005 / OD-008                            |
| Cloud hosting                 | Compute/storage   | MVP: single instance                       |
| Managed database              | vCPU/storage      | MVP: Postgres (local or minimal managed)   |
| Object storage                | Storage/egress    | Only if needed (V1.1+)                     |
| Monitoring / observability    | Per-node/usage    | Use OSS (e.g., self-hosted) where possible |

## 3. MVP Infrastructure (low-cost baseline)

- Backend: single instance/container.
- DB: PostgreSQL (local for dev; minimal managed or single-node for MVP).
- CI/CD: free tier of a standard provider.
- Observability: structured logs + health check; OSS error tracking.

## 4. Future-scale Infrastructure (later)

- Multiple backend instances + load balancer.
- Managed DB scaling, object storage, dedicated monitoring.
- Add only when user growth justifies it.

## 5. Mitigations

- Abstract external providers behind interfaces so providers can be swapped
  (OD-007/OD-008).
- Cache geocoding/distance results where appropriate.
- Cap/limit free tiers; monitor usage before cost grows.

## 6. Document Map

| Related doc                              | Purpose                          |
| ---------------------------------------- | -------------------------------- |
| `open-decisions.md`                      | OD-007/OD-008 provider decisions |
| `../architecture/system-architecture.md` | Infrastructure & cost principles |
| `../architecture/technical-decisions.md` | ADR-010 stack direction          |
