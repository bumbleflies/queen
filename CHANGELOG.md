# Changelog

## [0.24.3](https://github.com/bumbleflies/queen/compare/queen-v0.24.2...queen-v0.24.3) (2026-10-22)


### Bug Fixes

* **deps:** update dependency nodemailer to v10.2.1 ([#159](https://github.com/bumbleflies/queen/issues/159)) ([9d20e27](https://github.com/bumbleflies/queen/commit/9d20e27bf1cf0fb8309076abdb585a5b64e76f6c))

## [0.24.2](https://github.com/bumbleflies/queen/compare/queen-v0.24.1...queen-v0.24.2) (2026-10-22)


### Bug Fixes

* **deps:** update dependency @types/pdfkit to v0.17.7 ([#156](https://github.com/bumbleflies/queen/issues/156)) ([ab1cd18](https://github.com/bumbleflies/queen/commit/ab1cd1876193198ca5566dd03c7c4be60a2ad561))
* **deps:** update dependency dotenv to v18.0.9 ([#157](https://github.com/bumbleflies/queen/issues/157)) ([94ed665](https://github.com/bumbleflies/queen/commit/94ed665c2fb73c9a1d36419c5f2cfae7cbc2d93c))

## [0.24.1](https://github.com/bumbleflies/queen/compare/queen-v0.24.0...queen-v0.24.1) (2026-10-22)


### Bug Fixes

* **receipts:** keep the file name when reusing a stored reading ([#154](https://github.com/bumbleflies/queen/issues/154)) ([54005de](https://github.com/bumbleflies/queen/commit/54005de88cf3dc387ad674df770d0a2e15d90d54))

## [0.24.0](https://github.com/bumbleflies/queen/compare/queen-v0.23.0...queen-v0.24.0) (2026-10-22)


### Features

* **finance:** match invoices imported as paid without a bank payment ([d698d87](https://github.com/bumbleflies/queen/commit/d698d87db5783ba3750d67f11b1c10ad96a9f90c))

## [0.23.0](https://github.com/bumbleflies/queen/compare/queen-v0.22.2...queen-v0.23.0) (2026-10-22)


### Features

* **receipts:** read several receipts for one transaction ([#151](https://github.com/bumbleflies/queen/issues/151)) ([a65a642](https://github.com/bumbleflies/queen/commit/a65a6424ce202504e37ec0328d6f1f384a8f7188))

## [0.22.2](https://github.com/bumbleflies/queen/compare/queen-v0.22.1...queen-v0.22.2) (2026-10-22)


### Bug Fixes

* **finance:** confirm a posted entry without waiting for the refetch ([f6a6f06](https://github.com/bumbleflies/queen/commit/f6a6f06807a6f05006d6e46467865763a794476c))
* **finance:** confirm a posted entry without waiting for the refetch ([76d9071](https://github.com/bumbleflies/queen/commit/76d90719c1faf2a157d3a174ab414e09ec5ba502))
* **opencode:** read receipts on the V2 server ([#148](https://github.com/bumbleflies/queen/issues/148)) ([cec4180](https://github.com/bumbleflies/queen/commit/cec418036e13840050e1b91532f5041669a2c0e3))

## [0.22.1](https://github.com/bumbleflies/queen/compare/queen-v0.22.0...queen-v0.22.1) (2026-10-22)


### Bug Fixes

* **deps:** update dependency unpdf to v1.9.1 ([#144](https://github.com/bumbleflies/queen/issues/144)) ([c29764f](https://github.com/bumbleflies/queen/commit/c29764fad7d77f7a77cee5efe04218303939e2e6))

## [0.22.0](https://github.com/bumbleflies/queen/compare/queen-v0.21.1...queen-v0.22.0) (2026-10-22)


### Features

* booking automation — §13b, history suggestions, available cash, auto-booking, receipt reading ([0bffa39](https://github.com/bumbleflies/queen/commit/0bffa39896e72e5825f753c3cff09c8efb008dda))
* **bookings:** §13b mode in booking dialog, rules and import ([7d901e5](https://github.com/bumbleflies/queen/commit/7d901e5292149c9d39a8b348e7aa1e6c884b275f))
* **bookings:** opt-in automatic booking for IBAN/purpose rules in the daily reconcile ([1e78378](https://github.com/bumbleflies/queen/commit/1e7837821337365af7efcec8e940e0f33086e8a0))
* **bookings:** suggest from booking history when no rule matches ([e34e8f9](https://github.com/bumbleflies/queen/commit/e34e8f9b2664ed209a4922014118cf1d27613c33))
* **finance:** frei verfügbar card, dashboard tile and tax-rate setting ([486f381](https://github.com/bumbleflies/queen/commit/486f381407644c3493e2a141f72a8d3316961ef9))
* **finance:** receipt-read suggestions and Beleg auslesen ([00678e1](https://github.com/bumbleflies/queen/commit/00678e1e43b0a7e0b680309f319994391854b116))
* **finance:** show history suggestions ([d369ae4](https://github.com/bumbleflies/queen/commit/d369ae4f3090513a261fdd81c7ff01f973ee9002))
* **ledger:** §13b reverse-charge bank posting with accounts 1407/3837 ([c119f3d](https://github.com/bumbleflies/queen/commit/c119f3d85a0d1ce635c599c087a4c5eb4f694e56))
* **ledger:** available cash after taxes and liabilities ([8941da4](https://github.com/bumbleflies/queen/commit/8941da4f1554e3b834944ff4aac3445ed5473ae6))
* **ledger:** split bank postings across accounts and VAT rates ([a232edd](https://github.com/bumbleflies/queen/commit/a232edd3f1b9427b257b6ef1811f47d0e0b427de))
* **receipts:** opencode client with free-model tiers, backoff and one paid fallback ([41ce449](https://github.com/bumbleflies/queen/commit/41ce4494190ee770e1a3fe70162332e3e81eb092))
* **receipts:** read receipts via opencode into suggestions, incl. split and §13b ([3c26f6d](https://github.com/bumbleflies/queen/commit/3c26f6d6ad624f9e88cc62f45ce399fb94876093))


### Bug Fixes

* **bookings:** keep suggest pure, bound history to 3 years, test newest-3 selection ([87addec](https://github.com/bumbleflies/queen/commit/87addecf21f7591fe9f6c50c13fbf2656edbddc2))
* **bookings:** never auto-book reversed or incoming transactions ([4ad960a](https://github.com/bumbleflies/queen/commit/4ad960a4db1f476c2b099ed046f4593db2095358))
* **i18n:** estimated tax tooltip names only the prepayment accounts ([39c0c0a](https://github.com/bumbleflies/queen/commit/39c0c0a2946c0c7b03a936a841e36ad250e088ca))
* **ledger:** §13b rules always use 19 % ([c4be1ff](https://github.com/bumbleflies/queen/commit/c4be1ffd3fbc43de73263e789e08ba9081677b51))
* **ledger:** keep booking history apart per transaction direction ([f3011ca](https://github.com/bumbleflies/queen/commit/f3011ca656846e7ae9fd81fd14764eb2878fb6f6))
* **ledger:** load requested year and surface Firefly errors in availableCash ([2fd6de1](https://github.com/bumbleflies/queen/commit/2fd6de1ad960fc5a14c3938c6abd5a9d945c4735))
* **ledger:** only admins may change an autoBook rule via rememberRule ([b5ca089](https://github.com/bumbleflies/queen/commit/b5ca0890b7bdf6ee016e4d8e581d5bda89cf1b2a))
* **ledger:** verify derived bookings by re-posting; require two split parts ([76cbf1d](https://github.com/bumbleflies/queen/commit/76cbf1d57378bb905f92db119f9f5e50430c0901))
* **receipts:** bound receipt reading time; runNow skips reading ([4fe7f55](https://github.com/bumbleflies/queen/commit/4fe7f55fd75f000091d339688a0a3e7ecf98bf05))
* **receipts:** readReceipt only for open outgoing rows ([a7e2028](https://github.com/bumbleflies/queen/commit/a7e2028488011bb99489a444ee025aff2d958983))
* **receipts:** retry failed readings, wider bank-data masking, effective suggestion ([7f2de23](https://github.com/bumbleflies/queen/commit/7f2de230f18d9ec18a613fb204404975b6d8fab8))
* **receipts:** show stored reading state on load, incl. amount mismatch ([9951369](https://github.com/bumbleflies/queen/commit/99513695692cb6957e8754d16b98a52063006a63))
* **receipts:** type the skipped receipt-reading result in runReconcile ([86ffaf5](https://github.com/bumbleflies/queen/commit/86ffaf5f2e48b7b10a891cf83c3d21868e07baae))
* **rules:** mark §13b rules in the rules table ([27dae36](https://github.com/bumbleflies/queen/commit/27dae367a74c623f4757832e40a72c1b45d4728d))

## [0.21.1](https://github.com/bumbleflies/queen/compare/queen-v0.21.0...queen-v0.21.1) (2026-10-21)


### Bug Fixes

* **deps:** update dependency googleapis to v187 ([d2f6988](https://github.com/bumbleflies/queen/commit/d2f698852c2e76bb836a3e59df2e6a1fa2dbc85b))

## [0.21.0](https://github.com/bumbleflies/queen/compare/queen-v0.20.1...queen-v0.21.0) (2026-10-21)


### Features

* **finance:** inbox you can work through — tabs, row outcomes, one-click booking with undo ([7a2b03f](https://github.com/bumbleflies/queen/commit/7a2b03f9287aa3d3a425066e232698e15026ee8e))
* **finance:** inbox you can work through — tabs, row outcomes, one-click booking with undo ([79b713a](https://github.com/bumbleflies/queen/commit/79b713a09d9885247e742d58a8f122a0b1f3bb78))

## [0.20.1](https://github.com/bumbleflies/queen/compare/queen-v0.20.0...queen-v0.20.1) (2026-10-21)


### Bug Fixes

* **deps:** update dependency mongoose to v9.11.3 ([#136](https://github.com/bumbleflies/queen/issues/136)) ([1f98edc](https://github.com/bumbleflies/queen/commit/1f98edce4d229072c257d9a5d7d1f0ae00b8ccd3))

## [0.20.0](https://github.com/bumbleflies/queen/compare/queen-v0.19.27...queen-v0.20.0) (2026-10-21)


### Features

* **bookings:** match receipts from the Verwendungszweck and fix the receipt picker ([c513f11](https://github.com/bumbleflies/queen/commit/c513f1197a4550a32aa36f9b778072fa45b1616d))
* **bookings:** match receipts from the Verwendungszweck and fix the receipt picker ([658881b](https://github.com/bumbleflies/queen/commit/658881bc826db0185fb58372f473aa727ac168ee))
* **suppliers:** booking rules overview with JSON import/export ([4c778ae](https://github.com/bumbleflies/queen/commit/4c778aec14a27cd6d06848ac04b0e3b61047b246))
* **suppliers:** booking rules overview with JSON import/export ([74774c7](https://github.com/bumbleflies/queen/commit/74774c77024f0f9186c55b0d8697eb207635207c))


### Bug Fixes

* **deps:** update dependency nodemailer to v10.2.0 ([#135](https://github.com/bumbleflies/queen/issues/135)) ([e79acfb](https://github.com/bumbleflies/queen/commit/e79acfbf023b63dc6bbd6976da2b377eba8a3833))

## [0.19.27](https://github.com/bumbleflies/queen/compare/queen-v0.19.26...queen-v0.19.27) (2026-10-21)


### Bug Fixes

* **deps:** update dependency vite to v8.3.5 ([#130](https://github.com/bumbleflies/queen/issues/130)) ([0f98594](https://github.com/bumbleflies/queen/commit/0f985940633804f521eed0131dc4b7cb92e1c3bd))

## [0.19.26](https://github.com/bumbleflies/queen/compare/queen-v0.19.25...queen-v0.19.26) (2026-10-21)


### Bug Fixes

* **deps:** update dependency @hookform/resolvers to v6 ([#123](https://github.com/bumbleflies/queen/issues/123)) ([3fada75](https://github.com/bumbleflies/queen/commit/3fada75e31501f8ea3b4924f8b9634ebd67b3285))
* **deps:** update dependency googleapis to v187 ([#127](https://github.com/bumbleflies/queen/issues/127)) ([0006861](https://github.com/bumbleflies/queen/commit/0006861802b8d30828d1d1efa4b9dc4192ad5268))

## [0.19.25](https://github.com/bumbleflies/queen/compare/queen-v0.19.24...queen-v0.19.25) (2026-10-20)


### Bug Fixes

* **deps:** update dependency @tanstack/react-query to v5.104.5 ([#124](https://github.com/bumbleflies/queen/issues/124)) ([df663dd](https://github.com/bumbleflies/queen/commit/df663dd56417cc44da6dd0eeeb34381e0b2aa1d3))
* **deps:** update dependency oxlint to v1.89.0 ([#125](https://github.com/bumbleflies/queen/issues/125)) ([eb83780](https://github.com/bumbleflies/queen/commit/eb83780cbc2bd13d4c846f1fcf0fed5d00931ca7))

## [0.19.24](https://github.com/bumbleflies/queen/compare/queen-v0.19.23...queen-v0.19.24) (2026-10-18)


### Bug Fixes

* **deps:** update dependency nodemailer to v10.1.7 ([#121](https://github.com/bumbleflies/queen/issues/121)) ([a909095](https://github.com/bumbleflies/queen/commit/a9090958b5ae0c2525d59c3e3879d4a52497cfe4))

## [0.19.23](https://github.com/bumbleflies/queen/compare/queen-v0.19.22...queen-v0.19.23) (2026-10-18)


### Bug Fixes

* **deps:** update dependency nodemailer to v10.1.6 ([#119](https://github.com/bumbleflies/queen/issues/119)) ([6aa28ec](https://github.com/bumbleflies/queen/commit/6aa28ec8d239ca3b13ce62bd9de931681f7bfd4a))

## [0.19.22](https://github.com/bumbleflies/queen/compare/queen-v0.19.21...queen-v0.19.22) (2026-10-18)


### Bug Fixes

* **deps:** update dependency nodemailer to v10.1.5 ([#117](https://github.com/bumbleflies/queen/issues/117)) ([25a3453](https://github.com/bumbleflies/queen/commit/25a3453d49b9557317314582ed6545ba21a607aa))

## [0.19.21](https://github.com/bumbleflies/queen/compare/queen-v0.19.20...queen-v0.19.21) (2026-10-17)


### Bug Fixes

* **deps:** update dependency @tanstack/react-query to v5.104.4 ([#115](https://github.com/bumbleflies/queen/issues/115)) ([dfd2db1](https://github.com/bumbleflies/queen/commit/dfd2db1fd674eb15903612383f452605004381fd))

## [0.19.20](https://github.com/bumbleflies/queen/compare/queen-v0.19.19...queen-v0.19.20) (2026-10-17)


### Bug Fixes

* **deps:** update dependency @hookform/resolvers to v5.9.2 ([#113](https://github.com/bumbleflies/queen/issues/113)) ([3bd4964](https://github.com/bumbleflies/queen/commit/3bd496482f35d918191a3d5bb1f6fe4872a9f02a))

## [0.19.19](https://github.com/bumbleflies/queen/compare/queen-v0.19.18...queen-v0.19.19) (2026-10-16)


### Bug Fixes

* **deps:** update dependency nodemailer to v10.1.2 ([#111](https://github.com/bumbleflies/queen/issues/111)) ([0ad1622](https://github.com/bumbleflies/queen/commit/0ad16223b4a470b225ad60a9b3e8333d4912d8e6))

## [0.19.18](https://github.com/bumbleflies/queen/compare/queen-v0.19.17...queen-v0.19.18) (2026-10-16)


### Bug Fixes

* **deps:** update dependency google-auth-library to v11.3.1 ([#109](https://github.com/bumbleflies/queen/issues/109)) ([3e010e8](https://github.com/bumbleflies/queen/commit/3e010e8034c70afe35b4076da8b5ad06677b6984))

## [0.19.17](https://github.com/bumbleflies/queen/compare/queen-v0.19.16...queen-v0.19.17) (2026-10-15)


### Bug Fixes

* **deps:** update dependency vitest to v5.0.5 ([#106](https://github.com/bumbleflies/queen/issues/106)) ([8fd2613](https://github.com/bumbleflies/queen/commit/8fd261327950cae128e576662adfcfa1f024bb9d))

## [0.19.16](https://github.com/bumbleflies/queen/compare/queen-v0.19.15...queen-v0.19.16) (2026-10-15)


### Bug Fixes

* **deps:** update dependency jsdom to v30.1.3 ([#105](https://github.com/bumbleflies/queen/issues/105)) ([952df2e](https://github.com/bumbleflies/queen/commit/952df2efe629c8ddf074ac166d63825993b24095))

## [0.19.15](https://github.com/bumbleflies/queen/compare/queen-v0.19.14...queen-v0.19.15) (2026-10-15)


### Bug Fixes

* **deps:** update dependency googleapis to v186 ([#101](https://github.com/bumbleflies/queen/issues/101)) ([85e0d87](https://github.com/bumbleflies/queen/commit/85e0d872b2ce8347c5ff5ef4afd231ed1a7761d7))

## [0.19.14](https://github.com/bumbleflies/queen/compare/queen-v0.19.13...queen-v0.19.14) (2026-10-15)


### Bug Fixes

* **deps:** update dependency @tanstack/react-query to v5.104.3 ([#102](https://github.com/bumbleflies/queen/issues/102)) ([48e0546](https://github.com/bumbleflies/queen/commit/48e054664b92bc43e0818f7b073ea244f47514c0))

## [0.19.13](https://github.com/bumbleflies/queen/compare/queen-v0.19.12...queen-v0.19.13) (2026-10-14)


### Bug Fixes

* **deps:** update dependency dotenv to v18.0.8 ([#99](https://github.com/bumbleflies/queen/issues/99)) ([fc86c55](https://github.com/bumbleflies/queen/commit/fc86c55ece6497b303a436109507dc1f4daf2cd7))
* **deps:** update dependency nodemailer to v10.1.1 ([#97](https://github.com/bumbleflies/queen/issues/97)) ([4ace19e](https://github.com/bumbleflies/queen/commit/4ace19e4ba5513866dad19cd342dc7eb75651391))
* **deps:** update react monorepo to v19.3.1 ([#100](https://github.com/bumbleflies/queen/issues/100)) ([adb8159](https://github.com/bumbleflies/queen/commit/adb815949faf25dc7e4e91086865279a7e28493e))

## [0.19.12](https://github.com/bumbleflies/queen/compare/queen-v0.19.11...queen-v0.19.12) (2026-10-13)


### Bug Fixes

* **deps:** update dependency oxlint to v1.88.0 ([#95](https://github.com/bumbleflies/queen/issues/95)) ([26375ee](https://github.com/bumbleflies/queen/commit/26375ee266d7cc914e1c019d30af5633b344a0ad))

## [0.19.11](https://github.com/bumbleflies/queen/compare/queen-v0.19.10...queen-v0.19.11) (2026-10-13)


### Bug Fixes

* **deps:** update dependency @testing-library/user-event to v14.6.8 ([#92](https://github.com/bumbleflies/queen/issues/92)) ([ede9c26](https://github.com/bumbleflies/queen/commit/ede9c264af99e080625893172fd58915df40c241))
* **deps:** update dependency google-auth-library to v11.3.0 ([#93](https://github.com/bumbleflies/queen/issues/93)) ([39b3ad7](https://github.com/bumbleflies/queen/commit/39b3ad7253ac21002a5bcaa3f961268400732ae1))

## [0.19.10](https://github.com/bumbleflies/queen/compare/queen-v0.19.9...queen-v0.19.10) (2026-10-13)


### Bug Fixes

* **deps:** update dependency mongoose to v9.11.2 ([#89](https://github.com/bumbleflies/queen/issues/89)) ([8989f36](https://github.com/bumbleflies/queen/commit/8989f36d59c71b7cf001d78344c80f58c418eef5))
* **deps:** update dependency zod to v4.6.7 ([#90](https://github.com/bumbleflies/queen/issues/90)) ([e2ea2cb](https://github.com/bumbleflies/queen/commit/e2ea2cbb107bbcf2023e7eac09d30377782385d6))

## [0.19.9](https://github.com/bumbleflies/queen/compare/queen-v0.19.8...queen-v0.19.9) (2026-10-12)


### Bug Fixes

* **deps:** update dependency vitest to v5.0.4 ([#87](https://github.com/bumbleflies/queen/issues/87)) ([dc2a654](https://github.com/bumbleflies/queen/commit/dc2a6547c5f7b7a1f63020194f0953d6661b09e9))

## [0.19.8](https://github.com/bumbleflies/queen/compare/queen-v0.19.7...queen-v0.19.8) (2026-10-11)


### Bug Fixes

* **deps:** update dependency @tanstack/react-query to v5.104.2 ([#84](https://github.com/bumbleflies/queen/issues/84)) ([a5550ad](https://github.com/bumbleflies/queen/commit/a5550ad086f723cc53d12f437808d2c80550ba85))
* **deps:** update dependency zod to v4.6.6 ([#85](https://github.com/bumbleflies/queen/issues/85)) ([55a924a](https://github.com/bumbleflies/queen/commit/55a924a065d0fa5238fe53a6b632c76920101eb1))

## [0.19.7](https://github.com/bumbleflies/queen/compare/queen-v0.19.6...queen-v0.19.7) (2026-10-11)


### Bug Fixes

* **deps:** update dependency react-hook-form to v7.90.0 ([#82](https://github.com/bumbleflies/queen/issues/82)) ([9981bb9](https://github.com/bumbleflies/queen/commit/9981bb93d5617929bb7ed1d2dd8a59bf7e933ffc))

## [0.19.6](https://github.com/bumbleflies/queen/compare/queen-v0.19.5...queen-v0.19.6) (2026-10-10)


### Bug Fixes

* **deps:** update dependency nodemailer to v10.1.0 ([#80](https://github.com/bumbleflies/queen/issues/80)) ([6f8d7e9](https://github.com/bumbleflies/queen/commit/6f8d7e9c6d07d3689f6c414261dc4d2af83f9708))

## [0.19.5](https://github.com/bumbleflies/queen/compare/queen-v0.19.4...queen-v0.19.5) (2026-10-09)


### Bug Fixes

* **deps:** update dependency dotenv to v18.0.7 ([#77](https://github.com/bumbleflies/queen/issues/77)) ([7871ce3](https://github.com/bumbleflies/queen/commit/7871ce3e6ef1b498ecaeb48a5a0677516088face))
* **deps:** update dependency express to v5.3.0 ([#78](https://github.com/bumbleflies/queen/issues/78)) ([755b799](https://github.com/bumbleflies/queen/commit/755b79925af2d860ccd99858f0a36ce832441dd8))

## [0.19.4](https://github.com/bumbleflies/queen/compare/queen-v0.19.3...queen-v0.19.4) (2026-10-08)


### Miscellaneous Chores

* release 0.19.4 after Docker Hub token rotation ([46abcac](https://github.com/bumbleflies/queen/commit/46abcac6b0a1624f7c8fb846b27ac66b67bebd5c))

## [0.19.3](https://github.com/bumbleflies/queen/compare/queen-v0.19.2...queen-v0.19.3) (2026-10-08)


### Bug Fixes

* **deps:** update dependency concurrently to v10.0.6 ([#72](https://github.com/bumbleflies/queen/issues/72)) ([00978f0](https://github.com/bumbleflies/queen/commit/00978f0b874ec14daf05321d696b99a7a42a7af1))
* **deps:** update dependency vite to v8.3.4 ([#73](https://github.com/bumbleflies/queen/issues/73)) ([18c6683](https://github.com/bumbleflies/queen/commit/18c6683ea7955dcd9ea584c6ac125372dbf748d1))

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
