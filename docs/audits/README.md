# Audits

Home for audit-class documents (security, provider inventories, performance, accessibility, compliance, etc.). Each audit is a single self-contained, timestamped markdown file. Update this index whenever an audit is added or moved.

| Audit | Date (UTC) | Summary |
|---|---|---|
| [Prompt Runs native web search](WebSearch/2026-10-20/PROMPT_RUNS_NATIVE_WEB_SEARCH_AUDIT_2026-10-20.md) | 2026-10-20 | Read-only architecture and MVP readiness audit: current execution path, native provider/model capability, additive persistence, scoring isolation, phased implementation and acceptance plan. Flags Google grounding terms and automatic model routing as enablement gates. |
| [AUTH_SESSION_AUDIT_2026-06-01.md](AUTH_SESSION_AUDIT_2026-06-01.md) | 2026-06-01 | Read-only security review of authentication & session management — login/session/CSRF/RBAC/project-grants/credential-grants. Posture: strong for internal use, not yet bank-grade. Top gaps: no MFA, no email delivery for resets/invites, HSTS doc/code discrepancy. |
| [LLM_PROVIDER_AUDIT_REPORT_2026-05-05.md](LLM_PROVIDER_AUDIT_REPORT_2026-05-05.md) | 2026-05-05 | Full inventory of the 14 internal LLM call sites, the GPT-5.4-family defaults, and the `LLM_<FUNCTION>_MODEL` env → fallback resolution flow (Task #38). |

## Conventions

- **Filename:** `<TOPIC>_AUDIT_<YYYY-MM-DD>.md`, where the date is the UTC day the audit was generated.
- **Self-contained:** an audit inlines the evidence it needs, but still cites `file:line` / route / table / env var for traceability.
- **Read-only:** producing an audit does not change code, schema, or runtime config.
