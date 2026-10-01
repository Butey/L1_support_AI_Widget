# Навык: Customer Research (Customer Support)

- **ID:** `cs-customer-research`
- **Статус:** `ОТКЛЮЧЕН (выключен в настройках)`
- **Источник:** `github-anthropic`
- **Дата импорта:** `2026-08-25T11:35:45.711Z`
- **Размер контента:** 3242 символов

---

# /customer-research

Multi-source research on a customer question, product topic, or account-related inquiry. Synthesizes findings from all available sources with clear attribution and confidence scoring.

## Usage
`/customer-research <question or topic>`

## Workflow

### 1. Parse the Research Request
Identify what type of research is needed:
- **Customer question**: Something a customer has asked that needs an answer
- **Issue investigation**: Background on a reported problem
- **Account context**: History with a specific customer
- **Topic research**: General topic relevant to support work

Before searching, clarify what you're actually trying to find:
- Is this a factual question with a definitive answer?
- Is this a contextual question requiring multiple perspectives?
- Is this an exploratory question where the scope is still being defined?
- Who is the audience for the answer (internal team, customer, leadership)?

### 2. Search Available Sources

**Tier 1 — Official Internal Sources (highest confidence):**
- Knowledge base: product docs, runbooks, FAQs, policy documents
- Cloud storage: internal documents, specs, guides, past research
- Product roadmap (internal-facing): feature timelines, priorities

**Tier 2 — Organizational Context:**
- CRM notes: account notes, activity history, previous answers
- Support platform: previous resolutions, known issues, workarounds
- Meeting notes: previous discussions, decisions, commitments

**Tier 3 — Team Communications:**
- Chat channels: search for the topic in relevant channels
- Email: search for previous correspondence on this topic
- Calendar notes: meeting agendas and post-meeting notes

**Tier 4 — External Sources:**
- Web search: official documentation, blog posts, community forums
- Public knowledge bases, help centers, release notes
- Third-party documentation: integration partners, complementary tools

**Tier 5 — Inferred or Analogical:**
- Similar situations: how similar questions were handled before
- Analogous customers: what worked for comparable accounts
- General best practices: industry standards and norms

### 3. Synthesize Findings
Compile results into a structured research brief:

```
## Research: [Question/Topic]

### Answer
[Clear, direct answer to the question — lead with the bottom line]

**Confidence:** [High / Medium / Low]
[Explain what drives the confidence level]

### Key Findings
**From [Source 1]:**
- [Finding with specific detail]

**From [Source 2]:**
- [Finding with specific detail]

### Context & Nuance
[Any caveats, edge cases, or additional context that matters]

### Sources
1. [Source name/link] — [what it contributed]
2. [Source name/link] — [what it contributed]

### Gaps & Unknowns
- [What couldn't be confirmed]
- [What might need verification from a subject matter expert]

### Recommended Next Steps
- [Action if the answer needs to go to a customer]
- [Action if further research is needed]
- [Who to consult for verification if needed]
```

### 4. Handle Insufficient Sources
If no sources yield answers:
- State clearly what was searched and not found
- Suggest who might know (SME, team, partner)
- Offer to draft a question to send internally
- Never fabricate or guess — confidence: Low means Low
