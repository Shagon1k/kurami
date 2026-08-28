# Hermes weather provider

Use this profile only when the configured source has
`profile: hermes-weather`.

Use the built-in read-only weather capability for the configured `location`
and briefing date. Normalize the current conditions and useful daytime window
to `item-contract.md` with `kind: weather`. Keep temperature, precipitation
probability, condition, and source timestamp in structured metadata.

Do not browse for a replacement forecast when the configured capability fails.
Return a partial or failed weather batch without blocking other sources. This
profile has no acknowledgement or mutation operation.
