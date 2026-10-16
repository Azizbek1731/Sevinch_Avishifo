# Doctor laboratory referrals

During an editable consultation, the treating doctor selects one or more laboratory tests in the referral section and sends the referral to the cashier. The existing visit referral transaction creates the laboratory order and its issued invoice together. The doctor is recorded from the authenticated creator; request bodies cannot choose or impersonate a referring doctor.

Partial payment does not unlock specimen collection or result entry. The existing laboratory payment gate requires full net payment. Laboratory staff enter and approve results; the doctor can open them from the referral and the patient's clinical history, then continue the diagnosis and prescription. The consultation polls for updated referral status and approved history while it is open.

Lab order lists and detail pages show the referring doctor and selected tests. The laboratory's “Referrals by doctor” section and the reports tab share `GET /reports/lab-referrals`. Laboratory readers or report readers can view it; doctors are restricted to their own referrals. Excel export additionally requires `reports.export`.

The report uses the order creation date in Asia/Tashkent, an inclusive range of 1–366 calendar days, and the selected accessible branch. It excludes cancelled laboratory orders and cancelled invoices. It reports:

- Distinct patients and orders, and individual ordered tests, per doctor and test.
- Fully paid, awaiting-payment, and approved/delivered order counts.
- Reception/direct orders separately when no doctor created the order.

A patient with several tests is counted once in the doctor's patient total and once in the overall total. Consequently patient totals across doctors or tests must not be added to obtain the overall distinct patient count. Historical doctor names have a stored fallback; deleted or renamed staff do not remove historical referrals. Existing orders are attributed only where their recorded creator was a doctor; no doctor is guessed from an attached visit.

`doctor-lab-referrals.e2e-spec.ts` requires the isolated `avishifo_finance_migration` database, Redis database 14, `NODE_ENV=test`, and disabled Telegram. Its app overrides Telegram delivery. Never run its clinical fixtures against a working clinic database.
