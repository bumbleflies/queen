# Changelog

## [0.19.2](https://github.com/bumbleflies/queen/compare/queen-v0.19.1...queen-v0.19.2) (2026-10-08)


### Bug Fixes

* **receipts:** year folder from transaction date, not page filter ([#70](https://github.com/bumbleflies/queen/issues/70)) ([74c5f53](https://github.com/bumbleflies/queen/commit/74c5f53cfeb4180468100e11cf05b4819829cf55))

## [0.19.1](https://github.com/bumbleflies/queen/compare/queen-v0.19.0...queen-v0.19.1) (2026-10-08)


### Bug Fixes

* **drive:** request drive.readonly so folder picker and receipts can see existing files ([#68](https://github.com/bumbleflies/queen/issues/68)) ([58e5b28](https://github.com/bumbleflies/queen/commit/58e5b2852d0df29b17c10074023ce2c6442b30f3))

## [0.19.0](https://github.com/bumbleflies/queen/compare/queen-v0.18.1...queen-v0.19.0) (2026-10-08)


### Features

* drive folder settings + booking dialog modal ([#65](https://github.com/bumbleflies/queen/issues/65)) ([a147103](https://github.com/bumbleflies/queen/commit/a147103b9f6d75df85177631b82f4d3ae431a213))

## [0.18.1](https://github.com/bumbleflies/queen/compare/queen-v0.18.0...queen-v0.18.1) (2026-10-07)


### Bug Fixes

* **deps:** update dependency google-auth-library to v11.2.0 ([#63](https://github.com/bumbleflies/queen/issues/63)) ([1bc376a](https://github.com/bumbleflies/queen/commit/1bc376ae86abbafd1216aa09762bd0ba6b050055))

## [0.18.0](https://github.com/bumbleflies/queen/compare/queen-v0.17.0...queen-v0.18.0) (2026-10-07)


### Features

* **finance:** unify Bankabgleich, Buchen and Buchhaltung into one transaction stream ([35755a8](https://github.com/bumbleflies/queen/commit/35755a8e353bc775e4c853bfa0941382546bfc91))
* **finance:** unify Bankabgleich, Buchen and Buchhaltung into one transaction stream ([cdeeb27](https://github.com/bumbleflies/queen/commit/cdeeb27101878563861938ace5fab54d380e1032))


### Bug Fixes

* **finance:** assert both bank entry lines in stream test ([001ec0d](https://github.com/bumbleflies/queen/commit/001ec0dc168ec62236ba36bf66436520e16570fe))
* **finance:** stream test books the expense vat-free, matching the asserted lines ([603dcf9](https://github.com/bumbleflies/queen/commit/603dcf9897614415dd300ff4c5ded8ce9d3e9167))
* **finance:** stream test counted three year txs, not four ([d2596aa](https://github.com/bumbleflies/queen/commit/d2596aa513b73a36662da1f0e8c114ebec826569))

## [0.17.0](https://github.com/bumbleflies/queen/compare/queen-v0.16.1...queen-v0.17.0) (2026-10-07)


### Features

* **bank:** labeled RNR/KD recognition and paid-awaiting suggestions ([8c4a736](https://github.com/bumbleflies/queen/commit/8c4a73633a79d1cab9f90b5a926d6a58cfb938e2))
* **bank:** labeled RNR/KD recognition and paid-awaiting suggestions ([8646ca5](https://github.com/bumbleflies/queen/commit/8646ca50521974f1213097a0e3617e691d332496))

## [0.16.1](https://github.com/bumbleflies/queen/compare/queen-v0.16.0...queen-v0.16.1) (2026-10-07)


### Bug Fixes

* **bank:** read Firefly journal id from the split, not the journal attributes ([32f6ab2](https://github.com/bumbleflies/queen/commit/32f6ab296c5b8d1e529b01e52e57b2486671ea0d))
* **bank:** read Firefly journal id from the split, not the journal attributes ([d70912b](https://github.com/bumbleflies/queen/commit/d70912b9470c58de815bf1c390e4f4df28b145de))

## [0.16.0](https://github.com/bumbleflies/queen/compare/queen-v0.15.2...queen-v0.16.0) (2026-10-07)


### Features

* **bookings:** unified incoming/outgoing Buchen page with booking dialog and bulk confirm ([d5c57eb](https://github.com/bumbleflies/queen/commit/d5c57eb4e467d0d9a36db9ee2a383aec4b22cce5))
* **bookings:** unified incoming/outgoing Buchen page with booking dialog and bulk confirm ([64888c7](https://github.com/bumbleflies/queen/commit/64888c76a756648be1c80d5918b16a6c0a6294ce))

## [0.15.2](https://github.com/bumbleflies/queen/compare/queen-v0.15.1...queen-v0.15.2) (2026-10-07)


### Bug Fixes

* **ui:** ledger full-reimport uses the inline card dialog ([fa0924d](https://github.com/bumbleflies/queen/commit/fa0924dbfd4c9c4e30805140617f30b2e938bc56))

## [0.15.1](https://github.com/bumbleflies/queen/compare/queen-v0.15.0...queen-v0.15.1) (2026-10-07)


### Bug Fixes

* **deps:** update dependency googleapis to v184 ([3ad368c](https://github.com/bumbleflies/queen/commit/3ad368c13a95f46eb49906b7e87ff735668ad098))

## [0.15.0](https://github.com/bumbleflies/queen/compare/queen-v0.14.1...queen-v0.15.0) (2026-10-07)


### Features

* **ledger:** backfill dry-run/apply section on the ledger page ([9401f1f](https://github.com/bumbleflies/queen/commit/9401f1f2e7f60e51cd291af68cbaaabf770cf5bd))
* **ledger:** backfill dry-run/apply section on the ledger page ([ca38248](https://github.com/bumbleflies/queen/commit/ca382480513a789894be5f8cf5746a115441aa04))

## [0.14.1](https://github.com/bumbleflies/queen/compare/queen-v0.14.0...queen-v0.14.1) (2026-10-07)


### Bug Fixes

* **deps:** update dependency mongoose to v9.11.1 ([#43](https://github.com/bumbleflies/queen/issues/43)) ([abf07e0](https://github.com/bumbleflies/queen/commit/abf07e02f0eb3254e8748aa7b2a344e623cbbf9f))

## [0.14.0](https://github.com/bumbleflies/queen/compare/queen-v0.13.0...queen-v0.14.0) (2026-10-07)


### Features

* **bank:** full bank reimport button on the ledger page ([48f67f7](https://github.com/bumbleflies/queen/commit/48f67f76702e63a0fa5bc4f610e725ea1cd30808))
* **bank:** full bank reimport button on the ledger page ([d7468c8](https://github.com/bumbleflies/queen/commit/d7468c879e935fc5fa0ff6813e7caf656b58f1d6))

## [0.13.0](https://github.com/bumbleflies/queen/compare/queen-v0.12.1...queen-v0.13.0) (2026-10-07)


### Features

* allow all authenticated users CRUD; config stays admin-only ([0576af8](https://github.com/bumbleflies/queen/commit/0576af8533c6cb7f2feecd663855b4a86edde843))

## [0.12.1](https://github.com/bumbleflies/queen/compare/queen-v0.12.0...queen-v0.12.1) (2026-10-07)


### Bug Fixes

* **ci:** publish semver image tags from queen-v* releases ([b6185af](https://github.com/bumbleflies/queen/commit/b6185afa004d0e9763e81b2ec0aa22af32631c02))
* **ci:** strip queen-v prefix so semver image tags publish ([31900f4](https://github.com/bumbleflies/queen/commit/31900f46dc0e6e27826a17a84b8054ebf6490c85))

## [0.12.0](https://github.com/bumbleflies/queen/compare/queen-v0.11.0...queen-v0.12.0) (2026-10-07)


### Features

* accounting phase 2 — bank import and Buchen inbox (Tasks 1–5) ([475078f](https://github.com/bumbleflies/queen/commit/475078fad04dbeb26bc43d94bf0a59d5ed4d3d27))


### Bug Fixes

* **deps:** update dependency nodemailer to v10.0.16 ([#35](https://github.com/bumbleflies/queen/issues/35)) ([b7feac1](https://github.com/bumbleflies/queen/commit/b7feac1decb09694d16a40bdc69fe932ab4cae34))

## [0.11.0](https://github.com/bumbleflies/queen/compare/queen-v0.10.0...queen-v0.11.0) (2026-10-07)


### Features

* language switch as single toggle with flags, default from browser language ([413e60a](https://github.com/bumbleflies/queen/commit/413e60a20c0c3ce79311cc6b77ef9f0fa83d2c19))
* language switch as single toggle with flags, default from browser language ([95a5ae2](https://github.com/bumbleflies/queen/commit/95a5ae291f3dd1602347bb43e8ee843323af8ee1))

## [0.10.0](https://github.com/bumbleflies/queen/compare/queen-v0.9.0...queen-v0.10.0) (2026-10-07)


### Features

* ledger foundation (accounting phase 1) ([67f8cc4](https://github.com/bumbleflies/queen/commit/67f8cc4511eef15fb6127906490b3f653634800f))

## [0.9.0](https://github.com/bumbleflies/queen/compare/queen-v0.8.1...queen-v0.9.0) (2026-10-07)


### Features

* dark mode with system default and toggle ([65f3ef2](https://github.com/bumbleflies/queen/commit/65f3ef2eaa1aa6c2c068c37d172bc37ca2e3bce6))
* i18n (DE/EN), customer status fix, dark mode ([56c4412](https://github.com/bumbleflies/queen/commit/56c4412214d67e9c6d24ee8e9a0bda163c2bf84c))
* translate all pages DE/EN with topbar language switcher ([ad0e5a0](https://github.com/bumbleflies/queen/commit/ad0e5a0ceac55cba92d3076000735242d465afbf))


### Bug Fixes

* customer list shows aktiv + open/overdue summary ([768cc1c](https://github.com/bumbleflies/queen/commit/768cc1c7bc08e779e8327eb8a2216e843260107f))

## [0.8.1](https://github.com/bumbleflies/queen/compare/queen-v0.8.0...queen-v0.8.1) (2026-10-07)


### Bug Fixes

* **ui:** stop implying invoices are sent to the customer ([089f9d5](https://github.com/bumbleflies/queen/commit/089f9d5f2764a8769d20613bd4f42442811b5054))
* **ui:** stop implying invoices are sent to the customer ([e3e0862](https://github.com/bumbleflies/queen/commit/e3e08626317b3c0e1a08d0f11f7b4aff525cbdaf))

## [0.8.0](https://github.com/bumbleflies/queen/compare/queen-v0.7.0...queen-v0.8.0) (2026-10-07)


### Features

* add Open Graph share card and favicon ([7b9bea3](https://github.com/bumbleflies/queen/commit/7b9bea3ca9a97ed53529622d5519f6c63ab31da4))
* Open Graph share card and favicon ([589ac82](https://github.com/bumbleflies/queen/commit/589ac82a23cd8d2e725ba81d37673636615d0e99))

## [0.7.0](https://github.com/bumbleflies/queen/compare/queen-v0.6.1...queen-v0.7.0) (2026-10-07)


### Features

* **ui:** redesign dashboard with top bar shell and mobile-first layout ([414c422](https://github.com/bumbleflies/queen/commit/414c42205f4fe04134b6d701f73ce777dcb22e51))
* **ui:** redesign dashboard with top bar shell and mobile-first layout ([5834508](https://github.com/bumbleflies/queen/commit/5834508e6c482803e235676bbb937791b84d1a1e))

## [0.6.1](https://github.com/bumbleflies/queen/compare/queen-v0.6.0...queen-v0.6.1) (2026-10-07)


### Bug Fixes

* **ui:** open invoice positions expanded, cap content width on desktop ([9fa6411](https://github.com/bumbleflies/queen/commit/9fa6411c4f8ccfa71fbfca5f603835699171ce0c))
* **ui:** open invoice positions expanded, cap content width on desktop ([2dcb5bb](https://github.com/bumbleflies/queen/commit/2dcb5bb771d0b4001a42c57a59a425e48f6a5222))

## [0.6.0](https://github.com/bumbleflies/queen/compare/queen-v0.5.1...queen-v0.6.0) (2026-10-07)


### Features

* **admin:** linkDriveFiles to attach filed PDFs to imported invoices ([f546529](https://github.com/bumbleflies/queen/commit/f5465293cf134b6d3f8f5f792a661290b69871bb))
* **admin:** linkDriveFiles to attach filed PDFs to imported invoices ([95d3f8b](https://github.com/bumbleflies/queen/commit/95d3f8b266743cbd033fbd0aba5b205f8f435a4b))

## [0.5.1](https://github.com/bumbleflies/queen/compare/queen-v0.5.0...queen-v0.5.1) (2026-10-06)


### Bug Fixes

* **import:** find filed PDFs in year subfolders and with "Gebucht - " prefix ([0a42e93](https://github.com/bumbleflies/queen/commit/0a42e936a1ccfa5592ffa1f1ca994a27386f1077))
* **import:** find filed PDFs in year subfolders and with "Gebucht - " prefix ([750ff05](https://github.com/bumbleflies/queen/commit/750ff055e0b7e9f8c1d6e5d9727df8cce0b78082))

## [0.5.0](https://github.com/bumbleflies/queen/compare/queen-v0.4.0...queen-v0.5.0) (2026-10-06)


### Features

* **ui:** redesign login screen with branded centered card ([#13](https://github.com/bumbleflies/queen/issues/13)) ([ce37b6c](https://github.com/bumbleflies/queen/commit/ce37b6cc643f73a938a96678ae462fca9ef893cb))

## [0.4.0](https://github.com/bumbleflies/queen/compare/queen-v0.3.0...queen-v0.4.0) (2026-10-06)


### Features

* sheet import (admin.importSheet) with parity report ([338f107](https://github.com/bumbleflies/queen/commit/338f107f1b8aa3d6e1bf1f1675a753d9569eda6e))
* sheet import (admin.importSheet) with parity report ([e037928](https://github.com/bumbleflies/queen/commit/e037928544ddc25272e30f27805a9cbf957ba648))


### Bug Fixes

* **models:** drop duplicate fireflyJournalId index ([#9](https://github.com/bumbleflies/queen/issues/9)) ([d35c61d](https://github.com/bumbleflies/queen/commit/d35c61daeb226ebb92e2c95420fefd0fd8eed267))
* **models:** drop duplicate fireflyJournalId index (issue [#9](https://github.com/bumbleflies/queen/issues/9)) ([98c3f57](https://github.com/bumbleflies/queen/commit/98c3f5729f523aad0eb12f0425e5e6794b89a2b8))

## [0.3.0](https://github.com/bumbleflies/queen/compare/queen-v0.2.1...queen-v0.3.0) (2026-10-06)


### Features

* auth + tRPC context ([d5348d1](https://github.com/bumbleflies/queen/commit/d5348d1fdf45dfb3f399cb7aad69327abf8e31cc))
* **auth:** optional allowlist (bumbleflies-only OAuth client) + username admin mapping ([02dca19](https://github.com/bumbleflies/queen/commit/02dca19e26adfaab6ff8dafd903f263f2c62c8cb))
* auto-reconcile by Verwendungszweck ([c47622f](https://github.com/bumbleflies/queen/commit/c47622f0e34d03e4383b1fe1ab24c2f6357eef16))
* clients + invoices CRUD with state machine ([901b243](https://github.com/bumbleflies/queen/commit/901b2439481c0b1694c85f9d289d3ae4ab9d5080))
* Firefly client + bank sync ([a780808](https://github.com/bumbleflies/queen/commit/a780808d7711c78f914279cbb515fbacd43cb90a))
* money, numbering, invoice state machine ([4ba8044](https://github.com/bumbleflies/queen/commit/4ba80446fb23bbcbc625025d3b65419407e75676))
* PDF + Drive filing for generic invoices ([8b5c80b](https://github.com/bumbleflies/queen/commit/8b5c80bf9863f7baab52623dcd05c679df5def6c))
* queen core app (auth, invoicing, PDF/Drive, bank reconcile, UI) ([1384357](https://github.com/bumbleflies/queen/commit/1384357dba14fbe7952b334ec5962b230b28fa5d))
* queen UI ([2103037](https://github.com/bumbleflies/queen/commit/21030378dc8cdbc3197ef0b31b40cd054a4e9ff8))


### Bug Fixes

* address final review (admin bootstrap, manual assign, exact storno, credit-note filing, overpaid flag) ([62840e7](https://github.com/bumbleflies/queen/commit/62840e77defbec49d4f700c2e349f2af45fad7dd))
* address Task 2 review findings (session check, logout, token tests, env fail-fast) ([ccc783a](https://github.com/bumbleflies/queen/commit/ccc783a5ddf0622da8bdcaa36e5ae8978ee93f64))
* **deps:** update dependency dotenv to v18.0.6 ([779ceb0](https://github.com/bumbleflies/queen/commit/779ceb06eabe191e57564fc6339569e15c4653c3))
* **deps:** update dependency dotenv to v18.0.6 ([9770dfc](https://github.com/bumbleflies/queen/commit/9770dfca58d8a1ba5a29d8a28f05a11169e90673))
* Task 3 spec gaps (vatNote passthrough, numbering logic tests) ([33c0089](https://github.com/bumbleflies/queen/commit/33c0089c93a2739f0b2ffae7319537835f8cdde9))

## [0.2.1](https://github.com/bumbleflies/queen/compare/queen-v0.2.0...queen-v0.2.1) (2026-10-06)


### Bug Fixes

* **deps:** update dependency googleapis to v183 ([bf45737](https://github.com/bumbleflies/queen/commit/bf45737c1e9d4912a4017c725f0fde8e0be7bbd1))

## [0.2.0](https://github.com/bumbleflies/queen/compare/queen-v0.1.0...queen-v0.2.0) (2026-10-06)


### Features

* initial deployable queen scaffold ([982cb0e](https://github.com/bumbleflies/queen/commit/982cb0eef5df6b326f7fc1ae2222ef893df6c04f))
