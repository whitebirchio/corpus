# ADR-009: Keep original documents in R2, linked to extracted records

## Status
Accepted

## Date
2026-07-01

## Context
Labs and fitness tests arrive as PDFs. Some (the DexaFit reports) are image-only and must be LLM-parsed from rendered pages. Extraction can be wrong, and a better parse may be possible later.

## Decision
Retain source documents (lab PDFs, DEXA reports, meal photos, exports) in a **private R2 bucket**, each with a `documents` metadata row in Postgres linked to the records extracted from it. Access is only through short-lived presigned URLs issued to the authenticated user.

## Alternatives Considered

### Extract and discard
- Rejected: extractions couldn't be audited or repeated.

## Consequences
- Extractions are auditable and repeatable.
- Content-hash dedup applies to documents (ADR-008, tier 1).
- Uploading via presigned URL is clunky from a phone. v1 accepted this, since lab imports are infrequent and desktop-friendly; the ergonomics work is tracked in issue #7.

---
Backfilled 2026-10-25 from specs/01-initial-platform/SPEC.md §1 #6, §2 #4, §7, §11 #2 @ specs-archive.
