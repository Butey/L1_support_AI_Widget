# Навык: Draft Response (Customer Support)

- **ID:** `cs-draft-response`
- **Статус:** `ОТКЛЮЧЕН (выключен в настройках)`
- **Источник:** `github-anthropic`
- **Дата импорта:** `2026-08-25T11:35:45.711Z`
- **Размер контента:** 3736 символов

---

# /draft-response

Draft a professional, customer-facing response tailored to the situation, customer relationship, and communication context.

## Usage
`/draft-response <context about the customer question, issue, or request>`

Examples:
- `/draft-response Acme Corp is asking when the new dashboard feature will ship`
- `/draft-response Customer escalation — their integration has been down for 2 days`
- `/draft-response Responding to a feature request we won't be building`
- `/draft-response Customer hit a billing error and wants a resolution ASAP`

## Workflow

### 1. Understand the Context
Parse the user's input to determine:
- **Customer**: Who is the communication for? Look up account context if available.
- **Situation type**: Question, issue, escalation, announcement, negotiation, bad news, good news, follow-up
- **Urgency**: Is this time-sensitive? How long has the customer been waiting?
- **Channel**: Email, support ticket, chat, or other (adjust formality accordingly)
- **Relationship stage**: New customer, established, frustrated/escalated
- **Stakeholder level**: End user, manager, executive, technical, business

### 2. Research Context
Gather relevant background from available sources:
- Previous correspondence with this customer on this topic
- Any commitments or timelines previously shared
- Tone and style of the existing thread
- Internal discussions about this customer or topic
- Account details and plan level
- Related tickets and their resolution
- Known issues or workarounds
- Official documentation or help articles to reference

### 3. Generate the Draft
Produce a response tailored to the situation:

```
## Draft Response
**To:** [Customer contact name]
**Re:** [Subject/topic]
**Channel:** [Email / Ticket / Chat]
**Tone:** [Empathetic / Professional / Technical / Celebratory / Candid]

---
[Draft response text]
---

### Notes for You (internal — do not send)
- **Why this approach:** [Rationale for tone and content choices]
- **Things to verify:** [Any facts or commitments to confirm before sending]
- **Risk factors:** [Anything sensitive about this response]
- **Follow-up needed:** [Actions to take after sending]
- **Escalation note:** [If this should be reviewed by someone else first]
```

### 4. Quality Checks
Before presenting the draft, verify:
- Tone matches the situation and relationship
- No commitments beyond what's authorized
- No product roadmap details that shouldn't be shared externally
- Accurate references to previous conversations
- Clear next steps and ownership
- Appropriate for the stakeholder level
- Length is appropriate for the channel

## Customer Communication Best Practices

### Core Principles
1. **Lead with empathy**: Acknowledge the customer's situation before jumping to solutions
2. **Be direct**: Get to the point — customers are busy. Bottom-line-up-front.
3. **Be honest**: Never overpromise, never mislead, never hide bad news in jargon
4. **Be specific**: Use concrete details, timelines, and names — avoid vague language
5. **Own it**: Take responsibility when appropriate. "We" not "the system" or "the process"
6. **Close the loop**: Every response should have a clear next step or call to action
7. **Match their energy**: If they're frustrated, be empathetic first. If they're excited, be enthusiastic.

### Response Structure
1. Acknowledgment / Context (1-2 sentences)
2. Core Message (1-3 paragraphs)
3. Next Steps (1-3 bullets)
4. Closing (1 sentence)

### Length Guidelines
- **Chat/IM**: 1-4 sentences
- **Support ticket response**: 1-3 short paragraphs
- **Email**: 3-5 paragraphs max
- **Escalation response**: As long as needed, well-structured with headers
- **Executive communication**: 2-3 paragraphs max, data-driven
