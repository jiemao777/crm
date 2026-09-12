# Make Inquiry the canonical word, and treat "deal" as a compatibility alias

The glossary in CONTEXT.md is unambiguous: an Inquiry is tracked from first contact
to a won, lost or unqualified outcome, and "Deal" is listed as a word to avoid. The
code has already moved most of the way there. The `canonical_inquiry_stages`
migration rewrote every stage value (`DEMO_BOOKED` became `NEW_INQUIRY`,
`CONTRACT_SENT` became `PROFORMA_INVOICE`), `packages/db/src/deal-stage.ts` only
exports `INQUIRY_STAGES` and friends, and quotations, samples and orders all hang
off the inquiry lifecycle.

What has not moved is the physical naming. The table is still `deal`, the enum is
still `DealStage`, the API module and tRPC router are still `deals.*`, and the web
app still serves `/deals`. So a new contributor reads the glossary, then opens the
schema and finds the avoided word on the central table — and has to guess which one
is stale.

The case that made me notice: writing the record-sheet panels. The UI renders
"Quotation", "Samples" and "Orders" panels against a route called `/deals`, and the
quotation panel links back to its parent through a field the schema calls `dealId`.
Every new feature re-asks the same question: name this after the glossary, or after
the table it joins to?

What I'd do instead: declare the migration finished at the language level and
unfinished at the physical level, on purpose.

- New code uses the glossary words. Procedures, components, copy: inquiry,
  quotation, sample, sales order. No new `deal` identifiers.
- `deal`, `DealStage` and the `deals` module/router/route are compatibility
  aliases — documented as such, not treated as the real names.
- The physical rename (`deal` → `inquiry` table, `DealStage` → `InquiryStage`
  enum, `deals.*` → `inquiries.*`, `/deals` → `/inquiries`) happens as one
  deliberate sweep, or not at all. Piecemeal renaming is worse than either steady
  state, because it puts two live names on the same concept.

What it breaks: the sweep touches every Prisma query, the generated client, the
tRPC router names and therefore the `AppRouter` type the web app compiles against,
the `/deals` route and everything that links to it. That is exactly why it should
be one change with a migration and a type regeneration, done when there is quiet
time to verify it — not something to dribble in alongside feature work. Until then,
the cost of the alias is a comment's worth of confusion; the cost of doing it
halfway is permanent.
