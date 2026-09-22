# REPARK v7.0 OPERATIONAL MODES

## Mode 1: PROTOTYPE

### Purpose
Validate ideas fast. Kill bad ideas faster.

### Rules
| Aspect | Rule |
|--------|------|
| Blast Radius | UNLOCKED (any files may be touched) |
| Testing | Smoke test only |
| Security | Basic (no secrets committed) |
| Documentation | None required |
| Quality Gate | Manual smoke test |
| Deployment | Manual, can be ephemeral |
| Duration | Max 48 hours before Kill Decision |
| Hot-Swap | NOT REQUIRED |

### When to Use
- New idea validation
- Spike solutions
- Throwaway demos

### When to Exit
- **Proceed**: Idea validated → transition to PRODUCTION
- **Kill**: Idea rejected → archive and move on
- **Timeout**: 48 hours exceeded → mandatory Kill Decision

### Kill Decision Template
```markdown
## Kill Decision: [Project Name]
**Date**: [YYYY-MM-DD]
**Hours Invested**: [N]
**Validation Result**: [Positive/Negative/Inconclusive]

### Evidence
[Why this should proceed or die]

### Decision
- [ ] PROCEED → Next: Stage 2.0 preparation
- [ ] KILL → Archive to archive/v6/[name]/
```

---

## Mode 2: PRODUCTION

### Purpose
Ship real product to paying users.

### Rules
| Aspect | Rule |
|--------|------|
| Blast Radius | LOCKED (1-3 files per sprint) |
| Testing | Unit + integration required |
| Security | Full scan (secrets, RLS, XSS, CSRF) |
| Documentation | Inline + API contracts |
| Quality Gate | Full automated suite |
| Deployment | Automated CI/CD with rollback |
| Duration | Ongoing |
| Hot-Swap | REQUIRED for all new dependencies |

### When to Use
- Live product serving real users
- Features going to market
- Bug fixes for production users

### When to Exit
- **Enterprise**: Contract signed → fork to ENTERPRISE
- **Sunset**: Product archived → end of life

---

## Mode 3: ENTERPRISE

### Purpose
Client deliverables with SLA.

### Rules
| Aspect | Rule |
|--------|------|
| Blast Radius | CLIENT-SCOPED (contractually defined) |
| Testing | Full suite + regression + load test |
| Security | SOC2-compatible audit trail |
| Documentation | Full SPEC + ARCH + README |
| Quality Gate | Full + manual review |
| Deployment | Multi-environment (staging + prod) |
| Duration | Contract-defined |
| Hot-Swap | REQUIRED for all new dependencies |

### When to Use
- Client work with formal contract
- Deliverables with SLA
- Work that requires audit trail

### When to Exit
- **Fulfilled**: Contract completed → archive
- **Convert**: Internal use → fork to PRODUCTION

---

## Mode Transitions

```
PROTOTYPE → PRODUCTION
  Gate: User validation + security baseline
  Action: Refactor to production standards
  Approval: Quality Guardian (Agent 4) + Commander

PRODUCTION → ENTERPRISE
  Gate: Client contract + SLA terms
  Action: Fork with enterprise context
  Approval: Commander + Legal (if applicable)

ENTERPRISE → PRODUCTION
  Gate: Project completion + acceptance
  Action: Archive enterprise context
  Approval: Commander
```

## Mode Setting

Mode is set in `park-os/memory/ACTIVE_CONTEXT.md` at sprint start.
**Cannot be changed mid-sprint** without Commander approval.

## Mode Context for Agents

| Agent | PROTOTYPE | PRODUCTION | ENTERPRISE |
|-------|-----------|------------|------------|
| Market (0) | Validate fast | Monitor market | Client research |
| Product (1) | MVP only | Roadmap | Client specs |
| System (2) | Spikes | Stable arch | Client constraints |
| Engineer (3) | Ship fast | Refine | Deliver specs |
| Quality (4) | Light gate | Full gate | Audit gate |
| Deployment (5) | Manual | CI/CD | Multi-env |
| Growth (6) | Learn | Scale | Client reports |

---

**Established**: 2026-08-20
**Authority**: REPARK v7.0 Architecture Freeze
**Version**: 7.0