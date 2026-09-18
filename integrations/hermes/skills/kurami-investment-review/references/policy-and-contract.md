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
  version: 1,
  inputDigest: exact digest from calculate,
  headline: short Russian title,
  summary: 1–3 concise observations,
  positions: [{
    symbol,
    action: review | maintain | consider-add | consider-trim | consider-exit | not-assessed,
    factIds: [existing position-specific fact IDs],
    rationale, counterargument, revisitWhen
  }],
  nextSteps: at most 5 short paragraphs,
  proposedOrders: []
}
```

Every held symbol appears exactly once. `not-assessed` must not be presented as
an implicit hold recommendation. Each assessment requires evidence for that
same company, not merely an index or a different company's press release.
All proposed order lists are rejected in this trial version, even if monthly
usage happens to be known. Advice never writes holdings, receipts or cash.

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
