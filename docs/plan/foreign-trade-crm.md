# Foreign-trade CRM — what this system is

This repo started as a fork of trycompai's agentic CRM. It is no longer that
product. It is a foreign-trade CRM: buyer enquiries arrive by email, the system
files them against companies and contacts, and a rep works each one through
quotation, sampling and order completion. The older plans — `docs/crm-plan.md`
and `docs/plan/crm-plan.md` — describe the pre-pivot product and are kept for
reference only. Where they disagree with this document, this document is right,
because it describes what is actually deployed in the schema and the code.

## Vocabulary

The domain language lives in `CONTEXT.md`: **Inquiry**, **Quotation**,
**Sample**, **Sales Order**. "Deal" is the avoided word, but it is still the
physical name of the central table (`deal`), its enum (`DealStage`) and the API
module (`deals.*`). That truce is recorded in
`adrs/inquiry-vocabulary.md`: new code uses the glossary words, the physical
rename is one deliberate sweep or nothing. This document uses the glossary
words and gives the physical name in backticks where it matters.

## Data model

The schema is `packages/db/prisma/schema.prisma`. Everything hangs off four
records.

### The inquiry (`deal`)

An inquiry belongs to a company and an owner, carries a unique `inquiryNo`,
and moves through the stages renamed by the `canonical_inquiry_stages`
migration: `NEW_INQUIRY → CONTACTED → REPLIED → RFQ_RECEIVED → QUOTED →
SAMPLE → NEGOTIATING → PROFORMA_INVOICE`, closing as `WON`, `LOST` or
`UNQUALIFIED`. `stageChangedAt` records when it entered the current stage.

The trade fields are first-class: `productSummary`, `specification`,
`quantity`/`unit`, `targetPrice`, `incoterm`, `originPort`/`destinationPort`,
`paymentTerms`, `requiredDeliveryDate`, `quoteValidUntil`. Closing stamps
`closedAt` and `closedReason`. Contacts attach through the `DealContact` join.

### Quotation

A versioned offer against an inquiry: `@@unique([dealId, version])`, one
`quoteNumber` per version, status `DRAFT → SENT → …` (`QuotationStatus`),
line items in `QuotationItem` with `sortOrder`, money as `Decimal(14,2)`,
`validUntil`, `leadTimeDays`, and the trade terms copied forward so a sent
quotation survives later edits to the inquiry. `sentAt` marks when it went
out. A quotation converts to at most one sales order
(`SalesOrder.quotationId` is `@unique`).

### Sample

A physical sample while qualifying: status `REQUESTED → PREPARING → SHIPPED →
DELIVERED → APPROVED/REJECTED`, with courier, tracking number and ship-to.

### Sales order and payments

The confirmed order: `orderNumber`, status `DRAFT → CONFIRMED →
IN_PRODUCTION → READY_TO_SHIP → SHIPPED → DELIVERED → COMPLETED` (or
`CANCELLED`), production and ship/delivery dates, line items in
`SalesOrderItem`, and a `Payment` ledger (`DEPOSIT`/`BALANCE`/`INSTALLMENT`
with `expectedAt`/`receivedAt`) so the rep can see what is owed against what
has arrived.

### The mail schema

Email is stored, not linked. `EmailThread` groups by `rootMessageId` and can
be filed against a company and a contact; `category` marks `INQUIRY`,
`PROMOTION`, `NOTIFICATION` or `OTHER`. `EmailMessage` holds the full message
— direction, from, recipients, `body` and `bodyHtml`, `sentAt` — and is
deduplicated on `rfcMessageId @unique`, so Gmail and Zoho syncing the same
message converge on one row. Provenance is separate: `EmailMessageSync`
records which user and which source brought each message in, and
`EmailMessage.gmailMessageId` / `zohoMessageId` keep the provider ids.
Attachments store bytes in `EmailAttachment.content` (inline images via
`contentId`). `EmailDraft` (plus `EmailDraftAttachment`) is the outbound
side: `DRAFT → SENDING → SENT/FAILED`, threading headers kept so the sent
message lands back in the right thread.

Sync state is per mailbox, not per message. `MailboxSync` (Google side,
`@@unique([userId, source])`) and `ZohoMailbox`/`ZohoMailboxFolder` (Zoho
side) carry the cursors — history id or `uidValidity`/`lastUid` — plus
`status`, `lastError`, `retryAfter` and the `autoCreate` switch that decides
whether inbound mail may create CRM records. The Zoho IMAP password lives in
`ZohoMailbox.encryptedPassword`, encrypted at rest; see
`docs/environment.md` for the key.

## The mail → inquiry pipeline

Two sources feed one ingestion path.

**Zoho IMAP.** `apps/api/src/zoho/zoho-mail.service.ts` syncs each folder of
each `ZohoMailbox` by `uidValidity`/`lastUid`, parses with `mailparser`, and
hands every new message to ingestion. `zoho-connection.service.ts` verifies
credentials before they are saved; `zoho-smtp.service.ts` sends drafts.

**Gmail.** `apps/api/src/google/gmail-sync.service.ts` walks the history
cursor and hands the same shape of message to the same ingestion service.

**Ingestion** (`apps/api/src/mail/mail-ingestion.service.ts`) is the single
funnel: normalize, dedupe on `rfcMessageId`, thread by `In-Reply-To` /
`References` / subject, store message and attachments, update the thread's
`lastMessageAt`/`messageCount`. Both sync services call it; nothing else
writes mail rows.

**Lead intake** (`apps/api/src/mail/mail-lead-intake.service.ts`) turns a
thread into CRM records: `createCustomerFromThread` finds-or-makes the
company and contact from the sender, files the thread, and — when the
mailbox has `autoCreate` — opens the inquiry. Internal addresses never
become leads: the workspace domain and every member's address are filtered,
and a wholly internal thread stores nothing. `createCustomerFromThreadManual`
is the rep-triggered version from Mail Center for threads the automatic pass
left alone.

**The agent's part.** When intake cannot extract a clean company/contact from
headers and signature, it queues agent work. The agent's mail-intake path
(`apps/agent/agent/lib/mail-intake.ts`, tool `file_mail_thread.ts`) reads the
thread, extracts sender identity with a model, and files it — with the same
never-overwrite-a-human rule as every other enrichment write.

**Scheduling.** Locally, `local-sync-scheduler.service.ts` runs sync inside
the API process. Deployed, a cron hits the route in
`apps/api/src/google/sync.controller.ts`, guarded by `CRON_SECRET`. Both end
up in the same services.

## The agent

`apps/agent` is an eve deployment of its own; `docs/agent.md` is the full
reference. What matters here is what it does for the trade workflow. Its
tools (`apps/agent/agent/tools/`) fall into four groups:

- **Mail intake** — `file_mail_thread`, plus the extraction lib above.
- **Company research** — `research_company`, `enrich_company`,
  `create_company`, `read_company_history`: who is this buyer, what do they
  make or sell, brand and logo, with evidence scored before anything is
  written.
- **People** — `identify_contact`, `research_person`, the LinkedIn and
  work-history tools, `record_fact`, `record_job_change`, `write_brief`.
- **Self-management** — `list_outstanding_work`, `schedule_recheck`,
  `read_crm_history`, `read_deal_history`, `search_crm`,
  `write_workspace_profile`.

Work runs off the `AgentTask` queue with two dispatch lanes so a flood of
research never starves user-visible writes; `docs/agent.md` covers lanes,
leases and retries. The agent talks back to the CRM through the
`AGENT_BRIDGE_SECRET` channel, and reps see it in the record's **Agent** tab
and the global chat.

## Frontend surfaces

Routes under `apps/app/app/(app)/[slug]/`:

- **Companies / contacts / deals lists** — data tables with facets; the deal
  list is the inquiry pipeline.
- **Record sheets** — the right-side detail sheet; inquiries get
  `quotation-panel.tsx`, `samples-panel.tsx`, `orders-panel.tsx` and
  `quotation-print.tsx` (the printable offer).
- **Mail Center** — `mail/`: threads, categories, manual filing, drafts.
- **Dashboard** — `sales-dashboard.tsx`, pipeline and reminders.
- **Settings** — connections (Google, Zoho), agent and research model
  providers, members, SSO.
- **Global chat** and the per-record Agent tab — the agent's surface.
- **i18n** — `apps/app/lib/i18n*.ts`, `translated-text.tsx`, localized
  tables and date pickers.

## Deployment

Three deployments and a Postgres, per the README: the Next.js app and the
NestJS API on Vercel, the agent on its own eve deployment, and a Postgres
every side can reach. Locally: `docker compose up -d`, `bun run db:deploy`,
`bun run dev`. Environment variables — required and optional — are documented
in `.env.example` and `docs/environment.md`; anything a self-hoster might not
have is optional and removes a capability rather than throwing.

## Intelligence and known gaps

- **Inquiry intelligence is built.** Each open inquiry carries a deterministic
  health score (`score`, computed from stage age, activity recency, contact
  coverage and completeness — `packages/db/src/inquiry-score.ts`), a
  model-written rationale (`scoreSummary`) and a rolling forecast summary
  (`forecastContext`, with `forecastContextManual` winning in the UI when a rep
  overrides it). Recomputed by the `inquiry-intelligence` agent task on stage
  change, proforma conversion and new mail, plus a nightly sweep schedule.
- **No agent evals.** `apps/agent/evals` does not exist; extraction quality
  for mail intake and company research has no regression protection beyond
  the unit/integration specs.
- **The physical rename is pending.** `deal`/`DealStage`/`deals.*` stay until
  the one-sweep rename in `adrs/inquiry-vocabulary.md` is scheduled.
