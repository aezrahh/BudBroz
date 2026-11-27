import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  ageOn,
  cartValueCents,
  evaluateOrder,
  localDate,
  rulesFor,
  type CartLine,
  type DeliveryAddress,
} from '@budbroz/compliance';
import { distanceKm, seedDb, type Db, type Order, type OrderStatus } from './domain.js';
import { findDriver } from './dispatch.js';
import { MockIdVerifier, type IdVerifier } from './idVerifier.js';

export interface AppOptions {
  db?: Db;
  idVerifier?: IdVerifier;
  /** Injectable clock for tests. */
  now?: () => Date;
  state?: string;
}

const ACTIVE: OrderStatus[] = ['placed', 'accepted', 'assigned', 'picked_up', 'delivered'];

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const db = opts.db ?? seedDb();
  const ids = opts.idVerifier ?? new MockIdVerifier();
  const now = opts.now ?? (() => new Date());
  const rules = rulesFor(opts.state ?? 'MA');
  const app = Fastify({ logger: false });

  const setStatus = (order: Order, status: OrderStatus, note?: string) => {
    order.status = status;
    order.events.push({ at: now().toISOString(), status, ...(note ? { note } : {}) });
  };

  const releaseDriver = (order: Order) => {
    const driver = order.driverId ? db.drivers.get(order.driverId) : undefined;
    if (driver) driver.loadCents = Math.max(0, driver.loadCents - order.totalCents);
  };

  app.get('/health', async () => ({ ok: true, state: rules.state }));

  // Store search. Ranking is distance only: CCC rules require objective, consumer-oriented placement.
  app.get<{ Querystring: { lat?: string; lng?: string } }>('/stores', async (req) => {
    const lat = Number(req.query.lat ?? 42.3601);
    const lng = Number(req.query.lng ?? -71.0589);
    return [...db.stores.values()]
      .filter((s) => s.license.active && s.courierIds.length > 0)
      .map((s) => ({ id: s.id, name: s.name, town: s.town, distanceKm: Number(distanceKm(lat, lng, s.lat, s.lng).toFixed(2)) }))
      .sort((a, b) => a.distanceKm - b.distanceKm);
  });

  app.get<{ Params: { id: string } }>('/stores/:id/menu', async (req, reply) => {
    const store = db.stores.get(req.params.id);
    if (!store) return reply.code(404).send({ error: 'Store not found' });
    return [...db.products.values()].filter((p) => p.storeId === store.id && p.inStock > 0);
  });

  app.post<{ Body: { name: string } }>('/customers', async (req, reply) => {
    const id = randomUUID();
    const customer = {
      id,
      name: String(req.body?.name ?? ''),
      preVerified: false,
      dateOfBirth: null,
      idExpiry: null,
      idIssuingState: null,
      documentHash: null,
      verifiedAt: null,
    };
    db.customers.set(id, customer);
    return reply.code(201).send(customer);
  });

  // Pre-verification before the first delivery (935 CMR 500.145(4)).
  app.post<{ Params: { id: string }; Body: { barcode: string; consentToStateCheck?: boolean } }>(
    '/customers/:id/verify-id',
    async (req, reply) => {
      const customer = db.customers.get(req.params.id);
      if (!customer) return reply.code(404).send({ error: 'Customer not found' });
      if (typeof req.body?.barcode !== 'string') return reply.code(400).send({ error: 'barcode is required' });
      const r = await ids.verifyForSignup(req.body.barcode, req.body.consentToStateCheck === true);
      const today = localDate(now(), rules.timeZone);
      const reasons: string[] = [];
      if (r.verdict !== 'pass') reasons.push('The ID did not pass the scan checks.');
      if (!r.dateOfBirth || ageOn(r.dateOfBirth, today) < rules.minAgeAdultUse) reasons.push(`Must be ${rules.minAgeAdultUse} or older.`);
      if (!r.expiryDate || r.expiryDate < today) reasons.push('The ID is expired.');
      if (!r.stateConfirmed) reasons.push('The issuing state did not confirm the license.');
      if (reasons.length) return reply.code(422).send({ preVerified: false, reasons });
      Object.assign(customer, {
        preVerified: true,
        dateOfBirth: r.dateOfBirth,
        idExpiry: r.expiryDate,
        idIssuingState: r.issuingState,
        documentHash: r.documentHash,
        verifiedAt: now().toISOString(),
      });
      return { preVerified: true };
    },
  );

  app.post<{
    Body: { customerId: string; storeId: string; address: DeliveryAddress; items: { productId: string; quantity: number }[] };
  }>('/orders', async (req, reply) => {
    const { customerId, storeId, address, items } = req.body ?? ({} as any);
    const customer = db.customers.get(customerId);
    const store = db.stores.get(storeId);
    if (!customer || !store) return reply.code(404).send({ error: 'Customer or store not found' });
    if (!Array.isArray(items) || !address) return reply.code(400).send({ error: 'address and items are required' });

    const lines: CartLine[] = [];
    for (const item of items) {
      const p = db.products.get(item.productId);
      if (!p || p.storeId !== store.id) return reply.code(400).send({ error: `Product ${item.productId} is not sold by this store` });
      if (p.inStock < item.quantity) return reply.code(409).send({ error: `${p.name} is out of stock` });
      lines.push({
        productId: p.id,
        name: p.name,
        category: p.category,
        quantity: item.quantity,
        netWeightGrams: p.netWeightGrams,
        thcMg: p.thcMg,
        unitPriceCents: p.priceCents,
      });
    }

    const today = localDate(now(), rules.timeZone);
    const deliveriesToday = [...db.orders.values()].filter(
      (o) => o.customerId === customer.id && o.localDate === today && ACTIVE.includes(o.status),
    ).length;

    const check = evaluateOrder({
      rules,
      lines,
      customer: {
        preVerified: customer.preVerified,
        dateOfBirth: customer.dateOfBirth ?? '9999-01-01',
        idExpiry: customer.idExpiry ?? '0000-01-01',
      },
      address,
      towns: db.towns,
      deliveriesToday,
      sellerLicense: store.license,
      now: now(),
    });
    if (!check.ok) return reply.code(422).send({ error: 'Order not allowed', violations: check.violations });

    const order: Order = {
      id: randomUUID(),
      customerId: customer.id,
      storeId: store.id,
      lines,
      address,
      totalCents: cartValueCents(lines),
      status: 'placed',
      driverId: null,
      manifest: null,
      localDate: today,
      events: [],
    };
    setStatus(order, 'placed');
    db.orders.set(order.id, order);
    return reply.code(201).send(order);
  });

  app.get<{ Params: { id: string } }>('/orders/:id', async (req, reply) => {
    const order = db.orders.get(req.params.id);
    return order ?? reply.code(404).send({ error: 'Order not found' });
  });

  // Dispensary accepts, then dispatch assigns the nearest eligible driver.
  app.post<{ Params: { id: string } }>('/orders/:id/accept', async (req, reply) => {
    const order = db.orders.get(req.params.id);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    if (order.status !== 'placed') return reply.code(409).send({ error: `Order is ${order.status}` });
    setStatus(order, 'accepted');
    const driver = findDriver(db, order, rules, now());
    if (driver) {
      driver.loadCents += order.totalCents;
      order.driverId = driver.id;
      setStatus(order, 'assigned', `Driver ${driver.name}`);
    }
    return order;
  });

  app.post<{ Params: { id: string } }>('/orders/:id/reject', async (req, reply) => {
    const order = db.orders.get(req.params.id);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    if (order.status !== 'placed') return reply.code(409).send({ error: `Order is ${order.status}` });
    setStatus(order, 'rejected');
    return order;
  });

  // Pickup creates the delivery manifest (one per delivery, kept in the vehicle).
  app.post<{ Params: { id: string } }>('/orders/:id/pickup', async (req, reply) => {
    const order = db.orders.get(req.params.id);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    if (order.status !== 'assigned' || !order.driverId) return reply.code(409).send({ error: `Order is ${order.status}` });
    const driver = db.drivers.get(order.driverId)!;
    for (const l of order.lines) db.products.get(l.productId)!.inStock -= l.quantity;
    order.manifest = {
      id: randomUUID(),
      vehicle: driver.vehicle,
      driverId: driver.id,
      items: order.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity })),
      createdAt: now().toISOString(),
      reportedAt: null, // TODO: report to Metrc through the store's POS or the Metrc API.
    };
    setStatus(order, 'picked_up');
    return order;
  });

  // Door handoff: scan the ID, match it to the pre-verified one, photo and signature.
  app.post<{ Params: { id: string }; Body: { barcode: string; photoMatches: boolean; signatureCaptured: boolean } }>(
    '/orders/:id/handoff',
    async (req, reply) => {
      const order = db.orders.get(req.params.id);
      if (!order) return reply.code(404).send({ error: 'Order not found' });
      if (order.status !== 'picked_up') return reply.code(409).send({ error: `Order is ${order.status}` });
      const customer = db.customers.get(order.customerId)!;
      const scan = await ids.verifyAtDoor(String(req.body?.barcode ?? ''));
      const today = localDate(now(), rules.timeZone);
      const reasons: string[] = [];
      if (scan.verdict === 'fail') reasons.push('ID failed the scan checks.');
      if (!scan.documentHash || scan.documentHash !== customer.documentHash) reasons.push('ID does not match the pre-verified ID.');
      if (!scan.dateOfBirth || ageOn(scan.dateOfBirth, today) < rules.minAgeAdultUse) reasons.push('Recipient is under 21.');
      if (!scan.expiryDate || scan.expiryDate < today) reasons.push('ID is expired.');
      if (req.body?.photoMatches !== true) reasons.push('Photo does not match the recipient.');
      if (req.body?.signatureCaptured !== true) reasons.push('Signature not captured.');

      releaseDriver(order);
      if (reasons.length) {
        setStatus(order, 'returned', reasons.join(' '));
        return reply.code(422).send({ delivered: false, reasons, order });
      }
      setStatus(order, 'delivered');
      return { delivered: true, order };
    },
  );

  return app;
}
