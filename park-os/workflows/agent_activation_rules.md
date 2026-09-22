# REPARK v7.0 Agent Activation Rules

## Purpose
Determine which Agent(s) should activate for a given task.

## Core Rule
**Start with the minimum number of Agents. Add more only when dependencies require it.**

---

## Activation Matrix

| Task Type | Required Agents (in order) | Notes |
|-----------|---------------------------|-------|
| Small Bug Fix | Engineer → Quality | No scope change |
| Hotfix (Production) | Engineer → Quality → Deployment | Emergency, skip Growth |
| New Feature (Existing Product) | Engineer → Quality → Deployment → Growth | Incremental work |
| New Feature (New Area) | Product → System → Engineer → Quality → Deployment → Growth | Requires spec |
| New Product (Validated) | Market → Product → System → Engineer → Quality → Deployment → Growth | Full pipeline |
| Client Project | Product → System → Engineer → Quality → Deployment → Growth | Enterprise mode |
| Architecture Refactor | System → Engineer → Quality | No scope change |
| Performance Optimization | Engineer → Quality | Scope-limited |
| Content / Marketing | Growth | No code changes |
| Customer Research | Growth → Market | Feedback loop |
| Security Audit | Quality → Engineer → Quality | Verify fixes |

---

## Simplified Decision Tree

```
Is this a code change?
│
├─ NO
│   ├─ Is this customer-facing?
│   │   ├─ YES → Growth
│   │   └─ NO → Which Agent owns this area?
│   │           ├─ Market research → Market
│   │           └─ Product feedback → Product
│   │
│   └─ Is this infrastructure?
│       └─ YES → Deployment
│
└─ YES
    ├─ Is this a bug fix?
    │   ├─ YES → Engineer → Quality → Deployment
    │   └─ NO → Is there a new Product Spec?
    │           ├─ NO → Engineer → Quality → Deployment → Growth
    │           └─ YES → Is there a new System Spec?
    │                   ├─ NO → Product → System → [continue]
    │                   └─ YES → Is opportunity validated?
    │                           ├─ NO → Market → [continue]
    │                           └─ YES → [Full pipeline]
```

---

## Agent Handoff Rules

### Standard Handoff
Each Agent hands off to the **next in the dependency chain** after completing their work.

### Conditional Handoff
| Condition | Handoff |
|-----------|---------|
| Quality FAIL | Engineer (Agent 3) |
| Market KILL | STOP — archive project |
| Growth identifies new opportunity | Market (Agent 0) |
| Growth identifies feature need | Product (Agent 1) |

### Escalation
If multiple Agents conflict or cannot resolve:
1. Check `park-os/PRIORITY.md` for resolution
2. If unresolved → **Commander**

---

## Mode-Specific Activation

| Mode | Required Agents | Notes |
|------|----------------|-------|
| PROTOTYPE | Market → Product → System → Engineer | Quality optional, no Deployment, no Growth |
| PRODUCTION | Full pipeline | All 7 Agents required |
| ENTERPRISE | Full pipeline + Legal | Client-scoped, audit trail |

---

## Agent Availability by Phase

| Phase | Available Agents |
|-------|----------------|
| Phase 1 (Migration) | None (structural only) |
| Phase 2 (Current) | All 7 Agents |
| Phase 3 (Domain) | All 7 Agents + Domain Packs |

---

## Common Workflows

### Workflow 1: MVP Launch
```
Commander → Market (0) → Product (1) → System (2) → Engineer (3) → Quality (4) → Deployment (5) → Growth (6) → Commander
```

### Workflow 2: Bug Fix
```
Commander → Engineer (3) → Quality (4) → Deployment (5) → Growth (6) → Commander
```

### Workflow 3: Feature Request (from Customer)
```
Growth (6) → Product (1) → System (2) → Engineer (3) → Quality (4) → Deployment (5) → Growth (6) → Commander
```

### Workflow 4: Market Opportunity
```
Commander → Market (0)
  ├─ KILL → Archive
  └─ PROCEED → Product (1) → ...
```

---

## Priority Override

When in doubt about which Agent to activate:

1. **Safety issue** → Quality (Agent 4) immediately
2. **Deployment emergency** → Deployment (Agent 5) immediately
3. **Customer revenue at risk** → Growth (Agent 6) immediately
4. **Everything else** → Commander

---

**Established**: 2026-08-20
**Version**: 7.0
**Authority**: REPARK v7.0 Architecture Freeze