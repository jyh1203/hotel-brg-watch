# Reservation-first BRG workflow

Implemented 2026-10-27 following the owner's Telegram 5616 clarification.

## Two independent gates

1. Qualifying BRG comparison: current same-condition lowest Marriott rate versus a same-currency, full-stay, verified room-only competing offer, with hotel/date/occupancy/room/bed/inclusions/cancellation/payment/public access/availability/freshness checks preserved.
2. Financial benefit: room after the selected reward, plus Marriott's post-reward taxes/fees and the cost of cancelling the old reservation, must be strictly lower than the existing reservation's tax-inclusive total.

A lower headline or pre-tax saving alone cannot satisfy both gates. Marriott is the final eligibility and approval authority.

## Reservation modes

- Default `plan`: use the current official price to explore a potential new refundable direct booking. The old reservation's age does not block exploration. No booking has been made and no actual claim window is open.
- `new`: user explicitly records an actual newly completed reservation, its KST booking timestamp, full-stay pre-tax amount and direct/Bonvoy/lowest same-condition booking confirmation. The booked amount must match the current comparison baseline or require further review.
- `existing`: use the existing booking context; no clock reset is inferred from refundable status or a fresh price search.
- Actual readiness requires an absolute reservation timestamp and hotel-standard check-in instant; hotel-local time is converted using the configured IANA zone. No standard check-in hour is guessed.
- Booking after a previous claim rejection is not a promise of eligibility; the app does not book, cancel or submit.

## Costs and tax evidence

`approvalCost` uses 25% extra room discount by default (20% only when explicitly configured), or rate matching plus 5,000 Bonvoy points. Points do not receive the cash discount and are not valued as cash.

OTA checkout taxes must never be copied to Marriott. `allInEstimate` is a clearly labelled preview, not a verified saving. A confirmed calculation requires current `official.rate.approvedTaxRules` with:

- `verified: true`, matching `currency` and `scope: reservationScope(stay)`;
- a fresh `checkedAt`, nonempty `evidence`, `appliesToReward: discount|points`;
- nonnegative `percent` (fraction, at most 1) and `fixed`, describing Marriott charges after that reward.

The current collectors do **not** produce this post-reward tax evidence. The UI intentionally does not promote existing guesses to ready status. More complex tax structures require an extended schema rather than forced percent/fixed approximation.

Old-booking cancellation is zero only with declared free cancellation and an unexpired exact local deadline with known IANA zone. Unknown/expired cancellation cost prevents a verified financial gate; preview excludes that unknown cost and explicitly warns about it.

## Interface and persistence

Two gate summaries and expected cost are primary. Provider price rows, policy evidence, booking preferences and application draft are separate discoverable details. Verified room-only offers rank before lower unverified headlines. Rejected or stale observations cannot become application-ready. Re-evaluate before opening or copying a draft and periodically when not editing to expire time-sensitive readiness.

Preferences remain in this browser's localStorage with a reservation-scope fingerprint. Changed reservation details invalidate them. No reservation/member numbers are requested or stored. No server writes, booking mutation or auto submission exists. Private browsing/storage failure is reported accurately. Copy failure leaves a selectable plain-text fallback.

The draft includes observed conditions, missing checks, reward, calculation basis, timestamps and official handoff. Configured stable hotel URLs are allowed; checkout/session links are not. A generic hotel page is labelled as requiring exact offer reselection, never as a guaranteed direct offer link.

## Remaining service work (not represented as implemented)

- Reservation confirmation import and authenticated private account synchronization.
- Automated precise offer/cancellation/inclusions verification for every vendor and automatic post-reward Marriott tax evidence.
- Stable exact-offer handoff when a source currently exposes only a hotel page.
- Official form prefill/integration, claim response retrieval and proactive event notifications.

The owner approved website improvement, not any actual new reservation, cancellation or claim submission.

## Precision verification pipeline

`npm run verify:brg` uses `MARRIOTT_CDP_URL` and optional `STAY_IDS` with the dedicated regular Chrome. It executes owned-tab Marriott rate/policy reads followed sequentially by Hotels.com selected refundable/no-breakfast/pay-at-property checkout reads. The production `collect:full` CDP path performs the same verification by default; `SKIP_PRECISION=1` disables this additional branch explicitly. No booking/guest/card fields or final submission controls are sent.

The repeatable Hotels.com adapter reads visible selected calendar controls (including year), adult/child inputs and room counts, then selects one bed-compatible refundable/no-extras offer. It reads the full refund policy tab including the exact local cancellation time and penalty, then reconciles that same offer's full-stay checkout subtotal/taxes/city tax/total. Public access requires the visible sign-in option, guest checkout, no selected-rate restriction and current price. Missing room-name mapping remains unknown; bed alone never becomes a named Marriott room match.

Marriott inspection reads actual selected date/occupancy controls and member flexible details. The 24-hour freshness limit is not the claim window. An unchecked tax display toggle is not independent pretax proof in the precision path; explicit scoped totals and arithmetic are required. A fixed cancellation penalty is retained as a fixed amount, not automatically converted to “first night plus tax.”

`comparePreciseFacts` checks each actual source against the requested reservation, then against the other source; two sources agreeing on the wrong dates/hotel still fail. Matching, mismatching and unknown are separate states. The current model requires exact deadline and comparable penalty semantics. Current tax breakdown does not automatically establish post-BRG tax rules.

Verification resides in `data/marriott-status.json` per-stay `verification` and is included by the existing build. It is not appended to price history or a separate untracked file, preserving the existing unattended commit allowlist. The standalone verifier updates only verification; it does not refresh the ordinary collector's success timestamp. The UI retains each source's observation time and rejects a different reservation scope or stale proof for readiness.

Public page evidence excludes checkout/session URLs, credentials, cookies and personal input values. Stable property links are identified from observed provider property pages; navigation parameters are only targets, and visible controls remain the proof. Browser preferences continue to be local only. Source-specific failures remain partial/error observations rather than fabricated matching conditions.

Precision evidence suppresses the old `allInEstimate` headline if Marriott's VAT/pretax basis is explicitly unverified: keep the conditional post-discount room amount, but do not publish a fabricated final total/saving. Exact scoped current totals can be observed separately from verification that every tax is excluded.

Bind rate-details links to the selected flexible-member button's own rate container, not the first information icon in the room card. An earlier Stay Longer promotion may otherwise attach a different penalty to the flexible quote. Preserve lower observed refundable display rates as a warning that the flexible rate alone may not establish the lowest eligible direct reference; do not promote that unverified reference to eligible status.


For final-review reads, use only the exact accessible flexible-member button, validate the checkout room against the expected room/bed before attaching prices, and export only closed-set price labels/money/date tokens. Never retain an arbitrary ancestor's text from an authenticated booking page. The verification writer rejects account-like summaries and email/payment-identification strings before saving public status data. A changed checkout room suspends quote availability/price proof; it is not allowed to inherit the earlier rate-card identity.
