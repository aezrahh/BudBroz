import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ageOn,
  checkAddress,
  checkCart,
  checkCustomer,
  checkDailyLimit,
  checkDeliveryTime,
  checkLicense,
  checkVehicleLoad,
  evaluateOrder,
  massachusetts as ma,
  rulesFor,
  type CartLine,
  type TownRule,
} from '../src/index.js';

const towns: TownRule[] = [
  { town: 'Boston', deliveryAllowed: true },
  { town: 'Cambridge', deliveryAllowed: true, deliveryWindow: { start: '09:00', end: '21:00' } },
  { town: 'Dryville', deliveryAllowed: false },
];

// 2026-11-27 15:00 in Boston (UTC-5).
const afternoon = new Date('2026-11-27T20:00:00Z');

const flower = (grams: number, qty = 1): CartLine => ({
  productId: 'f1',
  name: 'Flower',
  category: 'flower',
  quantity: qty,
  netWeightGrams: grams,
  unitPriceCents: 4000,
});

test('rulesFor resolves Massachusetts and rejects unknown states', () => {
  assert.equal(rulesFor('ma').state, 'MA');
  assert.throws(() => rulesFor('ZZ'));
});

test('an ounce of flower is allowed, more is not', () => {
  assert.equal(checkCart([flower(28)], ma).ok, true);
  const over = checkCart([flower(14, 3)], ma);
  assert.equal(over.ok, false);
  assert.equal(over.violations[0].code, 'cart.over_limit');
});

test('concentrate and edibles count toward the ounce through equivalents', () => {
  const conc: CartLine = { productId: 'c', name: 'Wax', category: 'concentrate', quantity: 6, netWeightGrams: 1, unitPriceCents: 3000 };
  assert.equal(checkCart([conc], ma).ok, false); // 6 g concentrate > 5 g
  const gummies: CartLine = { productId: 'e', name: 'Gummies', category: 'edible', quantity: 2, thcMg: 100, unitPriceCents: 2000 };
  assert.equal(checkCart([flower(20), gummies], ma).ok, true);
});

test('products missing potency data are flagged', () => {
  const bad: CartLine = { productId: 'x', name: 'Mystery', category: 'edible', quantity: 1, unitPriceCents: 100 };
  assert.equal(checkCart([bad], ma).violations[0].code, 'cart.missing_potency');
});

test('ageOn handles birthdays', () => {
  assert.equal(ageOn('2005-11-28', '2026-11-27'), 20);
  assert.equal(ageOn('2005-11-27', '2026-11-27'), 21);
});

test('customer must be pre-verified, 21+ and hold an unexpired ID', () => {
  const ok = { preVerified: true, dateOfBirth: '1990-01-01', idExpiry: '2030-01-01' };
  assert.equal(checkCustomer(ok, ma, afternoon).ok, true);
  const codes = checkCustomer({ preVerified: false, dateOfBirth: '2006-01-01', idExpiry: '2025-01-01' }, ma, afternoon)
    .violations.map((v) => v.code);
  assert.deepEqual(codes, ['customer.not_verified', 'customer.underage', 'customer.id_expired']);
});

test('only residences in allowed Massachusetts towns', () => {
  const home = { line1: '1 Main St', town: 'Boston', state: 'MA', postalCode: '02108', placeType: 'apartment' as const };
  assert.equal(checkAddress(home, ma, towns).ok, true);
  assert.equal(checkAddress({ ...home, placeType: 'college_housing' }, ma, towns).ok, false);
  assert.equal(checkAddress({ ...home, town: 'Dryville' }, ma, towns).ok, false);
  assert.equal(checkAddress({ ...home, state: 'NH' }, ma, towns).violations[0].code, 'address.out_of_state');
});

test('delivery window is 7 AM to 11 PM local, and towns can only narrow it', () => {
  assert.equal(checkDeliveryTime(afternoon, ma).ok, true);
  assert.equal(checkDeliveryTime(new Date('2026-11-28T04:30:00Z'), ma).ok, false); // 11:30 PM
  assert.equal(checkDeliveryTime(new Date('2026-11-27T12:30:00Z'), ma).ok, true); // 7:30 AM
  const cambridge = towns[1];
  assert.equal(checkDeliveryTime(new Date('2026-11-27T12:30:00Z'), ma, cambridge).ok, false); // 7:30 AM
  const wide: TownRule = { town: 'Wide', deliveryAllowed: true, deliveryWindow: { start: '05:00', end: '23:59' } };
  assert.equal(checkDeliveryTime(new Date('2026-11-27T11:00:00Z'), ma, wide).ok, false); // 6 AM
});

test('one delivery per customer per day', () => {
  assert.equal(checkDailyLimit(0, ma).ok, true);
  assert.equal(checkDailyLimit(1, ma).ok, false);
});

test('vehicle cap is $5,000 with one agent and $10,000 with two', () => {
  assert.equal(checkVehicleLoad(400_000, 100_000, 1, ma).ok, true);
  assert.equal(checkVehicleLoad(400_000, 100_001, 1, ma).ok, false);
  assert.equal(checkVehicleLoad(900_000, 100_000, 2, ma).ok, true);
  assert.equal(checkVehicleLoad(0, 1, 0, ma).violations[0].code, 'vehicle.no_agent');
});

test('expired or out-of-state licenses block orders', () => {
  const lic = { number: 'MR123', type: 'retailer' as const, state: 'MA', expiresOn: '2027-06-30', active: true };
  assert.equal(checkLicense(lic, ma, afternoon).ok, true);
  assert.equal(checkLicense({ ...lic, expiresOn: '2026-01-01' }, ma, afternoon).ok, false);
  assert.equal(checkLicense({ ...lic, state: 'CA' }, ma, afternoon).ok, false);
});

test('evaluateOrder collects every violation', () => {
  const res = evaluateOrder({
    rules: ma,
    lines: [flower(30)],
    customer: { preVerified: true, dateOfBirth: '1990-01-01', idExpiry: '2030-01-01' },
    address: { line1: '1 Main St', town: 'Boston', state: 'MA', postalCode: '02108', placeType: 'hotel' },
    towns,
    deliveriesToday: 1,
    sellerLicense: { number: 'MR1', type: 'retailer', state: 'MA', expiresOn: '2027-01-01', active: true },
    now: afternoon,
  });
  assert.deepEqual(
    res.violations.map((v) => v.code),
    ['cart.over_limit', 'address.place_type', 'customer.daily_limit'],
  );
});
