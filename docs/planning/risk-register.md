# RidePool — Risk Register

> Status: Phase 0 — Planning
> Risks are not invented targets; each is plausible for a two-person MVP.

Legend — Probability / Impact: **L**ow · **M**edium · **H**igh.

| #   | Category    | Risk                                                    | Prob | Impact | Mitigation                                                                           | Owner / Phase      |
| --- | ----------- | ------------------------------------------------------- | ---- | ------ | ------------------------------------------------------------------------------------ | ------------------ |
| R1  | Product     | Low adoption in initial city                            | M    | H      | Validate in a focused geography; transparent cost sharing; minimal friction (OD-016) | Product / 1.1      |
| R2  | Marketplace | Too few published rides → empty discovery (cold start)  | H    | H      | Seed strategy, creator incentives, focused community launch                          | Product / 1.1      |
| R3  | Marketplace | Overbooking from concurrent seat requests               | M    | H      | Transactional seat allocation (ADR-011); concurrency tests                           | Tech / 1           |
| R4  | Technical   | State machine bugs causing illegal transitions          | M    | H      | Explicit state machine (lifecycle doc), guard functions, tests                       | Tech / 1           |
| R5  | Technical   | Stack choice later found unsuitable (lock-in)           | M    | M      | ADR-010 marked Proposed; OD-015 validation before locking                            | Tech / 1           |
| R6  | Safety      | Inappropriate/untrusted participants                    | M    | H      | Profile info, basic verification (OD-010), reporting/blocking baseline               | Product+Safety / 1 |
| R7  | Safety      | Abuse of cancellation                                   | M    | M      | Cancellation rules, frequency-based handling (no penalties in V1)                    | Product / 1.1      |
| R8  | Privacy     | Location data misuse or over-collection                 | M    | H      | Privacy-by-design (ADR-012), minimal collection, permission-gated                    | Tech / 1           |
| R9  | Legal       | Regulatory classification issues in launch jurisdiction | M    | H      | Qualified legal review before public launch (OD-017); no legal claims made           | Legal / pre-launch |
| R10 | Cost        | Variable-cost services (maps, push, OTP, hosting) rise  | M    | M      | Free/OSS first, vendor review, usage caps                                            | Tech / 1           |
| R11 | Scaling     | MVP architecture needs rewrite to grow                  | L    | M      | Modular monolith, scale-out instances; avoid premature microservices                 | Tech / future      |
| R12 | 3rd-party   | Map/geocode provider availability or cost changes       | M    | M      | Abstraction over provider; provider review (OD-007)                                  | Tech / 1           |
| R13 | 3rd-party   | Push/OTP provider reliability                           | M    | M      | In-app real-time fallback; provider review (OD-008)                                  | Tech / 1.1         |
| R14 | Product     | Participants surprised by pricing expectations          | M    | M      | Estimated contribution shown before request; transparent pricing                     | Product / 1        |
| R15 | Technical   | Data inconsistency between ride state and seat counts   | L    | H      | Invariants enforced in transactions; tests                                           | Tech / 1           |
| R16 | Product     | Scope creep into payments/chat/AI too early             | M    | M      | V1 scope doc; out-of-scope gate                                                      | Product / 1        |

## Document Map

| Related doc                | Purpose                          |
| -------------------------- | -------------------------------- |
| `open-decisions.md`        | Mitigation inputs (OD-*)         |
| `roadmap.md`               | Owner phases                     |
| `../product/v1-scope.md`   | Scope guard against creep (R16)  |
| `../domain/ride-engine.md` | Invariants/concurrency (R3, R15) |
