import { checkLicense, checkVehicleLoad, type StateRules } from '@budbroz/compliance';
import { distanceKm, type Db, type Driver, type Order } from './domain.js';

/**
 * Pick the nearest eligible driver for an order: online, registered agent,
 * employed by a licensed courier the store has a Delivery Agreement with,
 * and with room under the vehicle's product value cap.
 */
export function findDriver(db: Db, order: Order, rules: StateRules, now = new Date()): Driver | null {
  const store = db.stores.get(order.storeId);
  if (!store) return null;
  const candidates = [...db.drivers.values()].filter((d) => {
    if (!d.online || !d.agentRegistered) return false;
    if (!store.courierIds.includes(d.courierId)) return false;
    const courier = db.couriers.get(d.courierId);
    if (!courier || !checkLicense(courier.license, rules, now).ok) return false;
    return checkVehicleLoad(d.loadCents, order.totalCents, d.agentsInVehicle, rules).ok;
  });
  candidates.sort(
    (a, b) => distanceKm(a.lat, a.lng, store.lat, store.lng) - distanceKm(b.lat, b.lng, store.lat, store.lng),
  );
  return candidates[0] ?? null;
}
