# Policy and contract

## User policy

- Long-term savings, horizon five years or more, exceptional withdrawals only.
  A separate emergency reserve exists but its value is not known or included.
- Stocks and the existing VUAA holding; no crypto, options, leverage or shorts.
- Planned new external contributions EUR100–200 per calendar month, not an
  obligation to spend. Unused budget rollover is not assumed.
- At most five executed buy/sell orders together per calendar month. A sell
  followed by a buy is two orders, regardless of net cash flow. Partial fills
  should ultimately reconcile to their original order, not become extra orders.
- No-change is a valid result. Selling can be considered for deteriorating
  business evidence, excessive exposure against a separately agreed policy,
  valuation supported by actual research, or a changed liquidity need.
- A 30% or 50% portfolio decline is a stress scenario, NOT accepted risk
  tolerance, a prediction, a loss ceiling or an automatic liquidation trigger.
- Do not turn the current allocation into the user's target allocation.
  Amount-specific trade advice needs confirmed risk/target policy, current
  cash, current-month activity and applicable costs. These are unknown now.
- Missing purchase dates/cost basis prohibit personal P&L, tax estimates and
  claims about the profitability of a sale. A market price return is different.

## Inputs

`ReviewInput` is defined in `src/briefing/investment-review/model.ts`:
- `baseline`: immutable user-confirmed quantities, ISINs, date and month-usage
  knowns/unknowns. Decimal quantities are strings. Baseline older than 30 days
  requires reconfirmation before action consideration.
- `market`: the existing versioned Stocks snapshot, not a second quote provider.
- `fx`: ECB USD per EUR for the price date. USD values divide by this rate.
- `sources`: unique ID, title, HTTPS URL, data as-of date, retrieval timestamp.
- `facts`: unique ID, symbol, source ID, compact factual statement.
- Optional `fundHoldings`: fund ticker/ISIN, as-of date, source ID and percentage
  weights for the specifically researched overlapping constituents only.
- Optional `candidates`: at most two non-held companies, with symbol, name,
  exchange and `identitySourceId`. Facts can reference these symbols, but
  candidates never enter portfolio quantities, valuation or allocation.

Any missing, stale or identity-mismatched quote makes total/portfolio weights
unavailable rather than renormalizing the remaining known positions to 100%.
Fund look-through is explicitly approximate and dated. Do not claim complete
sector/geographic/FX exposure from a few top constituents or listing currency.

Calendar-month intervals are `[first day, first day of next month)` in local
date terms, including February/leap years. Monthly review covers the completed
previous month; its prospective budget window is the current calendar month.
Sunday review covers the preceding seven completed dates. A Friday trial is
explicitly a trial, not a completed Sunday edition. Prior-month usage does not
become current-month usage or an assumed unused allowance.

## Draft

```text
{
  version: 3,
  inputDigest: exact digest from calculate,
  headline: short Russian title,
  summary: 1–3 concise observations,
  positions: [{
    symbol,
    action: review | maintain | no-add | wait | consider-add | consider-trim | consider-exit | not-assessed,
    adviceReason: one concise position-specific reason,
    blockingInfo: specific missing decisive information for review, otherwise null,
    factIds: [existing position-specific fact IDs],
    rationale, portfolioMeaning, counterargument, revisitWhen,
    learningIds: [IDs of up to two relevant notes]
  }],
  learningNotes: [{id, term, explanation, example, limitation,
    reference: {title, url}}], // maximum three, collapsed by default
  ideas: [{symbol, factIds, rationale, portfolioMeaning, counterargument,
    alternative, valuationGap, revisitWhen}], // optional, zero to two
  nextSteps: at most 5 short paragraphs,
  proposedOrders: []
}
```

Every held symbol appears exactly once. `not-assessed` must not be presented as
an implicit hold recommendation. Each assessment requires evidence for that
same company, not merely an index or a different company's press release.
An additional fund-composition fact is allowed only for a constituent present
in the verified look-through map; own-company evidence is still required.
Learning references must use a supplied source URL or one of the canonical
educational references listed by the packet. Never construct a plausible URL.
All proposed order lists are rejected in this trial version, even if monthly
usage happens to be known. Advice never writes holdings, receipts or cash.
All learning-note IDs are unique and referenced by at least one position;
unknown links, oversized notes and unsafe URLs are rejected. Version-1 HTML
remains an archived artifact; new drafts use version 3 without a parallel
legacy renderer. Existing v2 HTML remains an archive; new drafts require v3.
Education links are reference material, not new price data.

## Advice decision rubric

Do not confuse "not proved cheap enough to buy" with "no useful advice".
There is no quota or forced distribution of labels, and no default hold:

- `maintain`: current evidence supports continuing the existing business/portfolio
  role, without a material reason to change now. State what supports this and what
  would invalidate it. It does not mean cheap, guaranteed safe, or worth adding.
- `no-add`: a concrete unresolved business, financing or overlap concern supports
  not committing more money now; it does not automatically imply selling existing
  shares. Don't declare allocation excessive against an unagreed target.
- `wait`: an identifiable pending result/event is decisive for the next step.
  Name it in `revisitWhen`; "wait for more information" is not enough.
- `consider-add`: business fit AND evidence about the current price relative to
  business results support adding; growth alone is not valuation evidence.
- `consider-trim/exit`: supported business-thesis deterioration or another
  explicit reason to reduce/exit. Do not require a fair-value model to discuss
  a broken thesis. State the consequence of being wrong and applicable unknown costs.
- `review`: evidence is conflicting, identity uncertain, or a specific missing
  fact prevents ANY supported stance above. Name the decisive gap and next check,
  not the generic absence of a full valuation model.
- `not-assessed`: actual coverage gap, not a cautious opinion.

Unknown current-month usage, purchase cost and cash block transaction amounts,
personal P&L/tax claims and execution; they do not automatically block a
qualitative hold/no-add/wait or reasoned discussion of reducing risk. Missing
target/risk policy still limits suitability claims. Never replace review with
hold just to remove an unhelpful label. Source quality takes precedence over UX.

Ideas are research-only and must use a registered candidate and its own facts.
No action, quantity, price target or order fields are accepted in an idea.
Explain the business, portfolio fit/overlap, risks, comparison with adding to
existing holdings or doing nothing, and missing valuation evidence. The
renderer always labels these as ideas to study, never recommendations to buy.
Do not fill slots just to reach two ideas. Broker availability is unverified.

## Later lifecycle — agreed, not activated

- Daily: existing programmatic quotes/discovery; substantive event-only notes
  later, not a full model run over every stock every day.
- Sunday: weekly research update. First day of month: completed-calendar-month
  review and next-month planning. Combine one run when the two dates coincide.
- One compact `/stocks` review block with Week/Month views, short summary and
  expandable details. No extra Daily blocks. These artifacts can contain
  personal quantities; check the actual access boundary before publishing.
- Keep latest successful weekly and monthly reports independently until replaced.
  A failed run never erases the accepted predecessor. Show data age/needs-review
  after changed holdings or material evidence, not false current guidance.
