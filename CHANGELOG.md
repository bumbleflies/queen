# Changelog

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
* Task 3 spec gaps (vatNote passthrough, numbering logic tests) ([33c0089](https://github.com/bumbleflies/queen/commit/33c0089c93a2739f0b2ffae7319537835f8cdde9))

## [0.2.1](https://github.com/bumbleflies/queen/compare/queen-v0.2.0...queen-v0.2.1) (2026-10-06)


### Bug Fixes

* **deps:** update dependency googleapis to v183 ([bf45737](https://github.com/bumbleflies/queen/commit/bf45737c1e9d4912a4017c725f0fde8e0be7bbd1))

## [0.2.0](https://github.com/bumbleflies/queen/compare/queen-v0.1.0...queen-v0.2.0) (2026-10-06)


### Features

* initial deployable queen scaffold ([982cb0e](https://github.com/bumbleflies/queen/commit/982cb0eef5df6b326f7fc1ae2222ef893df6c04f))
