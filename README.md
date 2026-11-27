# Budbroz

Delivery marketplace for licensed cannabis retailers: customers find nearby dispensaries, build an order, and a driver from a licensed courier delivers it. Launch state: **Massachusetts** (adult use).

Plan, compliance notes and open decisions: [Budbroz plan doc](https://claude.ai/artifact/G8AFpjMzM6dbb4DZ4hUzAZ).

## Layout

| Path | What it is | Status |
| --- | --- | --- |
| `packages/compliance` | State rules engine: order limits, ID and age, delivery zones and hours, vehicle caps, licenses. Massachusetts rules from 935 CMR 500.145 | Working, tested |
| `services/api` | Backend: store search, menus, ID pre-verification, orders, dispensary accept/reject, dispatch, pickup manifest, door ID check | Working with in-memory data, tested |
| `apps/` | Customer PWA, dispensary portal, driver app, admin console | Next phase |

## Running it

Requires Node 20+.

```bash
npm install
npm test           # compliance and API tests
npm run dev:api    # http://localhost:4000
```

The API uses fictional Boston-area seed data (stores, a courier company, two drivers) held in memory.

### ID verification

The API talks to the ID Check service through `services/api/src/idVerifier.ts`.

- Without configuration it uses a mock. Mock barcodes look like `MOCK|MA|S12345678|DOE|JANE|1990-05-01|2030-05-01`.
- Set `ID_SERVICE_URL` (and optionally `ID_SERVICE_API_KEY`) to call a running ID Check server's `/api/verify` and `/api/confirm-license`.
- Set `ID_HASH_SALT` to a long random secret in any real environment. Budbroz stores only a salted hash of the license number, never the barcode.

## Compliance notes

- Every rule lives in `packages/compliance/src/rules/ma.ts` with its source. Values listed in `unverified` there (dry-weight equivalents for concentrates and edibles) are placeholders that need confirmation by Massachusetts counsel.
- Drivers must be employees and registered agents of a licensed Courier or Delivery Operator, so dispatch only offers orders to drivers of couriers the store has a Delivery Agreement with.
- Store ranking is by distance only, because the CCC requires objective placement on technology platforms.
- Metrc reporting is stubbed: manifests are created at pickup with `reportedAt: null`.
