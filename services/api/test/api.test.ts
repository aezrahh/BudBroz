import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { seedDb } from '../src/domain.js';

// Friday 2026-11-27, 3 PM in Boston.
const now = () => new Date('2026-11-27T20:00:00Z');
const ADULT_ID = 'MOCK|MA|S12345678|DOE|JANE|1990-05-01|2030-05-01';
const MINOR_ID = 'MOCK|MA|S99999999|KID|SAM|2008-01-01|2030-01-01';
const home = { line1: '1 Beacon St', town: 'Boston', state: 'MA', postalCode: '02108', placeType: 'apartment' };

async function verifiedCustomer(app: ReturnType<typeof buildApp>) {
  const c = (await app.inject({ method: 'POST', url: '/customers', payload: { name: 'Jane' } })).json();
  const v = await app.inject({
    method: 'POST',
    url: `/customers/${c.id}/verify-id`,
    payload: { barcode: ADULT_ID, consentToStateCheck: true },
  });
  assert.equal(v.statusCode, 200);
  return c.id as string;
}

test('store search hides unlicensed stores and sorts by distance', async () => {
  const app = buildApp({ now });
  const stores = (await app.inject('/stores?lat=42.36&lng=-71.06')).json();
  assert.deepEqual(stores.map((s: any) => s.id), ['store-1', 'store-2']);
});

test('minors and unconsented checks are not pre-verified', async () => {
  const app = buildApp({ now });
  const c = (await app.inject({ method: 'POST', url: '/customers', payload: { name: 'Sam' } })).json();
  const minor = await app.inject({ method: 'POST', url: `/customers/${c.id}/verify-id`, payload: { barcode: MINOR_ID, consentToStateCheck: true } });
  assert.equal(minor.statusCode, 422);
  const noConsent = await app.inject({ method: 'POST', url: `/customers/${c.id}/verify-id`, payload: { barcode: ADULT_ID } });
  assert.equal(noConsent.statusCode, 422);
});

test('unverified customers cannot order', async () => {
  const app = buildApp({ now });
  const c = (await app.inject({ method: 'POST', url: '/customers', payload: { name: 'X' } })).json();
  const res = await app.inject({
    method: 'POST',
    url: '/orders',
    payload: { customerId: c.id, storeId: 'store-1', address: home, items: [{ productId: 'p-1', quantity: 1 }] },
  });
  assert.equal(res.statusCode, 422);
  assert.ok(res.json().violations.some((v: any) => v.code === 'customer.not_verified'));
});

test('full order: place, accept, dispatch, pickup, door check, deliver', async () => {
  const db = seedDb();
  const app = buildApp({ db, now });
  const customerId = await verifiedCustomer(app);

  const placed = await app.inject({
    method: 'POST',
    url: '/orders',
    payload: { customerId, storeId: 'store-1', address: home, items: [{ productId: 'p-1', quantity: 2 }, { productId: 'p-3', quantity: 1 }] },
  });
  assert.equal(placed.statusCode, 201);
  const id = placed.json().id;

  const accepted = (await app.inject({ method: 'POST', url: `/orders/${id}/accept` })).json();
  assert.equal(accepted.status, 'assigned');
  assert.equal(accepted.driverId, 'driver-1'); // nearest to the store
  assert.equal(db.drivers.get('driver-1')!.loadCents, 11500);

  const picked = (await app.inject({ method: 'POST', url: `/orders/${id}/pickup` })).json();
  assert.equal(picked.status, 'picked_up');
  assert.equal(picked.manifest.vehicle.plate, 'DEV-001');
  assert.equal(db.products.get('p-1')!.inStock, 38);

  const done = await app.inject({
    method: 'POST',
    url: `/orders/${id}/handoff`,
    payload: { barcode: ADULT_ID, photoMatches: true, signatureCaptured: true },
  });
  assert.equal(done.statusCode, 200);
  assert.equal(done.json().order.status, 'delivered');
  assert.equal(db.drivers.get('driver-1')!.loadCents, 0);

  // Second delivery the same day is blocked.
  const again = await app.inject({
    method: 'POST',
    url: '/orders',
    payload: { customerId, storeId: 'store-1', address: home, items: [{ productId: 'p-1', quantity: 1 }] },
  });
  assert.equal(again.statusCode, 422);
  assert.ok(again.json().violations.some((v: any) => v.code === 'customer.daily_limit'));
});

test('a different ID at the door means no handoff', async () => {
  const app = buildApp({ now });
  const customerId = await verifiedCustomer(app);
  const id = (
    await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { customerId, storeId: 'store-1', address: home, items: [{ productId: 'p-1', quantity: 1 }] },
    })
  ).json().id;
  await app.inject({ method: 'POST', url: `/orders/${id}/accept` });
  await app.inject({ method: 'POST', url: `/orders/${id}/pickup` });
  const res = await app.inject({
    method: 'POST',
    url: `/orders/${id}/handoff`,
    payload: { barcode: 'MOCK|MA|S00000001|ROE|RICH|1985-01-01|2030-01-01', photoMatches: true, signatureCaptured: true },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().order.status, 'returned');
});

test('over-limit carts and dorm addresses are refused', async () => {
  const app = buildApp({ now });
  const customerId = await verifiedCustomer(app);
  const res = await app.inject({
    method: 'POST',
    url: '/orders',
    payload: {
      customerId,
      storeId: 'store-2',
      address: { ...home, town: 'Cambridge', placeType: 'college_housing' },
      items: [{ productId: 'p-5', quantity: 1 }, { productId: 'p-4', quantity: 1 }],
    },
  });
  assert.equal(res.statusCode, 422);
  const codes = res.json().violations.map((v: any) => v.code);
  assert.deepEqual(codes, ['cart.over_limit', 'address.place_type']);
});

test('dispatch skips a driver whose vehicle would exceed the cap', async () => {
  const db = seedDb();
  db.drivers.get('driver-1')!.loadCents = 495_000; // one agent, $5,000 cap
  const app = buildApp({ db, now });
  const customerId = await verifiedCustomer(app);
  const id = (
    await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { customerId, storeId: 'store-1', address: home, items: [{ productId: 'p-2', quantity: 1 }] },
    })
  ).json().id;
  const accepted = (await app.inject({ method: 'POST', url: `/orders/${id}/accept` })).json();
  assert.equal(accepted.driverId, 'driver-2');
});
