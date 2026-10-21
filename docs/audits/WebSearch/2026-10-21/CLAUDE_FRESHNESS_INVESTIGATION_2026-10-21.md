# Claude freshness failure — frozen investigation record

**Decision:** Owner accepted the documented quality limitation for R1A, keeping
both Claude and OpenAI in the release. This does not authorize publishing,
activation or further spending. The freshness assertions remain **failed**.

## Exact test and prompt

Test: identify the **latest stable point release**, not merely the latest major
version, of Firefox at answer time using official release notes.

The exact saved user message, including the pilot's common suffix, was:

```text
Check Mozilla's official release notes. What is the current stable Firefox version and release date at the time of your answer? Answer in English without emojis. Finish with a short Sources section listing the literal official URLs. Do not invent facts or citations.
```

Both executions used this same prompt. The second was an inherited-ON rerun,
not a corrective follow-up conversation.

## Request parameters

These are reconstructed from the tested source and saved prompt/run policy;
the raw outbound HTTP body was not logged.

| Parameter | Value |
| --- | --- |
| Endpoint / method | `POST https://api.anthropic.com/v1/messages` |
| API version header | `anthropic-version: 2023-06-01` |
| Content type | `application/json` |
| Model | `claude-sonnet-5` |
| Messages | One user message containing the exact prompt above |
| `max_tokens` | `8000` |
| Tool | `{"type":"web_search_20250305","name":"web_search","max_uses":5}` |
| Service tier | `standard_only`, set by the development pilot guard |
| Temperature / top-p / top-k | Not supplied; provider default values were not captured |
| Thinking | Not supplied |
| Tool choice | Not supplied; automatic invocation policy, not forced search |
| Streaming | Not requested |
| Domain allow/block lists, user location, freshness/time filter | Not supplied; official-source preference was prompt text, not an enforced domain filter |
| Explicit current date in application prompt/system | None; only “at the time of your answer”; provider-internal context unknown |
| Whole-item deadline | `180000` ms |
| Run retry configuration | Maximum `2`; actual evidence shows **one attempt**, no retry/continuation, in each case |
| Whole-item search ceiling | `5`; actual use **2**, in each case |

Exact application system message:

```text
You are a helpful AI assistant. When answering questions:
1. Provide detailed, informative responses
2. Include specific examples, company names, and brand mentions where relevant
3. If discussing products, services, or companies, mention specific names and compare options
4. Include URLs or sources when possible (use actual URLs if you know them)
5. If ranking or listing options, be specific about positioning and order
```

Authentication is deliberately excluded. No API key, cookie or password belongs
in this record.

## Case A — initial current-fact probe

- Run: `3a6d167d-3911-4f6f-875c-2885a4c41fa0`
- Run created: `2026-10-20T20:00:58.163Z`
  (October 21, 00:00:58.163 Asia/Dubai).
- Provider request: `req_011CgE5qGQePSBCVjHDC2trH`
- Provider message: `msg_011CgE5qHPwJ8ej2BUBPjd7F`
- Native generation duration: `6390` ms; input/output tokens: `18912 / 483`.
- Actual model: `claude-sonnet-5`; search invoked; 2 searches; 14 retained
  sources, 2 native citations; no omitted consulted sources.
- Core run: `done`; deliverables: `ready`.

Full saved canonical answer, with readable whitespace:

```text
Based on Mozilla's official release notes, the current stable version of Firefox is Firefox 158.0.

Version 158.0 was first offered to Release channel users on October 13, 2026.

This is confirmed by the developer-focused release notes as well, which state that

Firefox 158 was released on October 13, 2026.

Note that there is also a minor point release, Firefox 157.0.1, which was offered earlier in October, but it has since been superseded by the 158.0 stable release described above. For enterprise/ESR users, Firefox ESR 153.5.0 was also released on the same date, October 13, 2026.

## Sources
- https://www.firefox.com/en-US/firefox/158.0/releasenotes/
- https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/158
- https://firefox-admin-docs.mozilla.org/release-notes/
```

## Case B — same-prompt inherited-ON rerun

- Run: `87bff62e-6490-461f-938d-89506eb77335`
- Run created: `2026-10-20T20:07:19.379Z`
  (October 21, 00:07:19.379 Asia/Dubai).
- Provider request: `req_011CgE6KNKPM6fYrc1V1H9wF`
- Provider message: `msg_011CgE6KPMdtTs7TG6M2sfSR`
- Native generation duration: `11753` ms; input/output tokens: `19375 / 1113`.
- Actual model: `claude-sonnet-5`; search invoked; 2 searches; 18 retained
  sources, 5 native citations; no omitted consulted sources.
- Core run: `done`; deliverables: `ready`.

Full saved canonical answer, with readable whitespace:

```text
Based on Mozilla's official release notes, here is the current stable Firefox version information:

**Current Stable Version: Firefox 158.0**
**Release Date: October 13, 2026**

This is confirmed across multiple official Mozilla sources. The MDN developer release notes state:

Firefox 158 release notes for developers (Stable). This article provides information about the changes in Firefox 158 that affect developers. Firefox 158 was released on October 13, 2026.

This is further corroborated by Mozilla's enterprise release notes documentation, which lists

Firefox 158 Latest, October 13, 2026... Firefox ESR 153 is the current ESR

, confirming 158 as the latest standard release channel version at this time.

Additionally, the MDN Nightly and Beta channel pages confirm the version lineage, showing the release train structure as

Firefox 158 (Stable), Firefox 159 (Beta), Firefox 160 (Nightly)

, with Firefox 159 (Beta)

current Beta version of Firefox and ships on October 27, 2026

, and Firefox 160 (Nightly)

current Nightly version of Firefox and ships on November 10, 2026

. This confirms Firefox 158 remains the current stable release as of the time of this answer (mid-to-late October 2026), since Firefox 159 has not yet moved from Beta to Stable.

It's worth noting that Firefox uses a rapid release cycle, so a minor point release (e.g., 158.0.1) could appear between major versions for urgent bug or security fixes, but as of the available official release notes, 158.0 (October 13, 2026) is the latest confirmed stable release.

## Sources
- https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/158
- https://firefox-admin-docs.mozilla.org/release-notes/
- https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/159
- https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/160
```

## Exact failure assertion and frozen ground truth

Both answers claimed **158.0 / October 13** was current. The available stable
point release was **158.0.1 / October 20, 2026**.

- Release notes: `https://www.firefox.com/en-US/firefox/158.0.1/releasenotes/`.
- Official feed: `https://product-details.mozilla.org/1.0/firefox_versions.json`.
- Direct feed check: `2026-10-20T20:17:13Z`; value
  `LATEST_FIREFOX_VERSION: "158.0.1"`.
- Response `Last-Modified: Tue, 20 Oct 2026 13:52:47 GMT`, before both runs;
  `Cache-Control: max-age=300`; `Age: 95`.
- A separate extracted/cached fetch returned an older feed value; do not use
  that cached extraction to overrule the timestamped direct official response.

This expectation is **historical**, not a claim about whichever version is
latest when this record is read. The failure is factual freshness/selection,
not missing search, invalid native attribution or a pipeline error. The cause
is not established; two of five permitted searches were used, so search-budget
exhaustion is not supported by this evidence.

## Evidence fidelity and investigation limits

The companion [machine-readable evidence](CLAUDE_FRESHNESS_TEST_EVIDENCE_2026-10-21.json)
contains the complete reconstructed request, exact canonical answer strings
(including whitespace), all retained sources, native citation ranges, usage,
model identity, provider IDs and counters for both cases. This Markdown uses
readable whitespace only.

Canonical text is not raw Anthropic message JSON: Polaris joins provider text
blocks with blank lines and retains native citations separately. Raw provider
search queries, search-result excerpts and the full wire response were **not
retained**. They cannot be recovered or claimed from this record. Run timestamps
above are creation times, not exact HTTP dispatch timestamps.

Investigation leads, not conclusions: major-versus-point-release selection,
retrieval/index freshness, lack of an explicit as-of date, and unfiltered
automatic search. Any new experiments must keep the original baseline intact
and obtain a fresh paid scope if provider calls are involved. No rerun was made
to prepare this record.
