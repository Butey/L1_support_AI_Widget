# Навык: Ticket Triage (Customer Support)

- **ID:** `cs-ticket-triage`
- **Статус:** `ОТКЛЮЧЕН (выключен в настройках)`
- **Источник:** `github-anthropic`
- **Дата импорта:** `2026-08-25T11:35:45.711Z`
- **Размер контента:** 3993 символов

---

# /ticket-triage

Categorize, prioritize, and route an incoming support ticket or customer issue. Produces a structured triage assessment with a suggested initial response.

## Usage
`/ticket-triage <ticket text, customer message, or issue description>`

Examples:
- `/ticket-triage Customer says their dashboard has been showing a blank page since this morning`
- `/ticket-triage "I was charged twice for my subscription this month"`
- `/ticket-triage User can't connect their SSO — getting a 403 error on the callback URL`
- `/ticket-triage Feature request: they want to export reports as PDF`

## Workflow

### 1. Parse the Issue
Read the input and extract:
- **Core problem**: What is the customer actually experiencing?
- **Symptoms**: What specific behavior or error are they seeing?
- **Customer context**: Who is this? Any account details, plan level, or history available?
- **Urgency signals**: Are they blocked? Is this production? How many users affected?
- **Emotional state**: Frustrated, confused, matter-of-fact, escalating?

### 2. Categorize and Prioritize
- Assign a **primary category** (bug, how-to, feature request, billing, account, integration, security, data, performance)
- Assign a **priority** (P1–P4) based on impact and urgency
- Identify the **product area** the issue maps to

### 3. Check for Duplicates and Known Issues
Before routing, check available sources:
- Search for similar open or recently resolved tickets
- Check for known issues or existing documentation
- Check if there's an existing bug report or feature request

### 4. Determine Routing
Recommend which team or queue should handle this based on category and complexity.

### 5. Generate Triage Output
```
## Triage: [One-line issue summary]

**Category:** [Primary] / [Secondary if applicable]
**Priority:** [P1-P4] — [Brief justification]
**Product area:** [Area/team]

### Issue Summary
[2-3 sentence summary of what the customer is experiencing]

### Key Details
- **Customer:** [Name/account if known]
- **Impact:** [Who and what is affected]
- **Workaround:** [Available / Not available / Unknown]
- **Related tickets:** [Links to similar issues if found]
- **Known issue:** [Yes — link / No / Checking]

### Routing Recommendation
**Route to:** [Team or queue]
**Why:** [Brief reasoning]

### Suggested Initial Response
[Draft first response to the customer — acknowledge the issue, set expectations, provide workaround if available.]

### Internal Notes
- [Any additional context for the agent picking this up]
- [Reproduction hints if it's a bug]
- [Escalation triggers to watch for]
```

## Category Taxonomy

| Category | Description | Signal Words |
|----------|-------------|-------------|
| **Bug** | Product is behaving incorrectly or unexpectedly | Error, broken, crash, not working, unexpected, wrong, failing |
| **How-to** | Customer needs guidance on using the product | How do I, can I, where is, setting up, configure, help with |
| **Feature request** | Customer wants a capability that doesn't exist | Would be great if, wish I could, any plans to, requesting |
| **Billing** | Payment, subscription, invoice, or pricing issues | Charge, invoice, payment, subscription, refund, upgrade, downgrade |
| **Account** | Account access, permissions, settings, or user management | Login, password, access, permission, SSO, locked out, can't sign in |
| **Integration** | Issues connecting to third-party tools or APIs | API, webhook, integration, connect, OAuth, sync, third-party |
| **Security** | Security concerns or data issues | Breach, vulnerability, unauthorized, data leak, compliance |

## Priority Framework
- **P1 (Critical)**: Service down, data loss, security breach — all users or key accounts affected
- **P2 (High)**: Major feature broken, significant impact, no workaround — affecting multiple users
- **P3 (Medium)**: Feature issue with workaround, non-blocking, single user affected
- **P4 (Low)**: Minor issue, cosmetic, feature request, general question
