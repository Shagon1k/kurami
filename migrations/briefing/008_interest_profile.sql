-- Compact provenance only; reactions and their original topic sets are preserved.
ALTER TABLE reaction_events ADD COLUMN context_json TEXT;
