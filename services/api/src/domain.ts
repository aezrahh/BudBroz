import type { CartLine, DeliveryAddress, LicenseRecord, ProductCategory, TownRule } from '@budbroz/compliance';

export interface Store {
  id: string;
  name: string;
  state: string;
  town: string;
  lat: number;
  lng: number;
  license: LicenseRecord;
  /** Courier companies this retailer has a CCC-filed Delivery Agreement with. */
  courierIds: string[];
}

export interface Product {
  id: string;
  storeId: string;
  name: string;
  category: ProductCategory;
  netWeightGrams?: number;
  thcMg?: number;
  priceCents: number;
  inStock: number;
}

export interface Courier {
  id: string;
  name: string;
  license: LicenseRecord;
}

export interface Driver {
  id: string;
  courierId: string;
  name: string;
  /** Marijuana Establishment Agent registration is current. */
  agentRegistered: boolean;
  online: boolean;
  agentsInVehicle: number;
  vehicle: { make: string; model: string; plate: string };
  lat: number;
  lng: number;
  loadCents: number;
}

export interface Customer {
  id: string;
  name: string;
  preVerified: boolean;
  dateOfBirth: string | null;
  idExpiry: string | null;
  idIssuingState: string | null;
  documentHash: string | null;
  verifiedAt: string | null;
}

export type OrderStatus = 'placed' | 'accepted' | 'assigned' | 'picked_up' | 'delivered' | 'returned' | 'rejected';

export interface Manifest {
  id: string;
  vehicle: Driver['vehicle'];
  driverId: string;
  items: { productId: string; name: string; quantity: number }[];
  createdAt: string;
  /** Set once the manifest is reported to the state seed-to-sale system (Metrc). */
  reportedAt: string | null;
}

export interface Order {
  id: string;
  customerId: string;
  storeId: string;
  lines: CartLine[];
  address: DeliveryAddress;
  totalCents: number;
  status: OrderStatus;
  driverId: string | null;
  manifest: Manifest | null;
  localDate: string;
  events: { at: string; status: OrderStatus; note?: string }[];
}

export interface Db {
  stores: Map<string, Store>;
  products: Map<string, Product>;
  couriers: Map<string, Courier>;
  drivers: Map<string, Driver>;
  customers: Map<string, Customer>;
  orders: Map<string, Order>;
  towns: TownRule[];
}

const lic = (number: string, type: LicenseRecord['type']): LicenseRecord => ({
  number,
  type,
  state: 'MA',
  expiresOn: '2027-12-31',
  active: true,
});

/** Fictional Boston-area seed data for development. */
export function seedDb(): Db {
  const stores: Store[] = [
    { id: 'store-1', name: 'Harbor Leaf', state: 'MA', town: 'Boston', lat: 42.3601, lng: -71.0589, license: lic('MR-DEV-0001', 'retailer'), courierIds: ['courier-1'] },
    { id: 'store-2', name: 'Charles River Cannabis', state: 'MA', town: 'Cambridge', lat: 42.3736, lng: -71.1097, license: lic('MR-DEV-0002', 'retailer'), courierIds: ['courier-1'] },
    { id: 'store-3', name: 'Southie Greens', state: 'MA', town: 'Boston', lat: 42.3334, lng: -71.0495, license: { ...lic('MR-DEV-0003', 'retailer'), active: false }, courierIds: [] },
  ];
  const products: Product[] = [
    { id: 'p-1', storeId: 'store-1', name: 'Blue Dream 3.5 g', category: 'flower', netWeightGrams: 3.5, priceCents: 4500, inStock: 40 },
    { id: 'p-2', storeId: 'store-1', name: 'Live Resin 1 g', category: 'concentrate', netWeightGrams: 1, priceCents: 5500, inStock: 20 },
    { id: 'p-3', storeId: 'store-1', name: 'Gummies 100 mg', category: 'edible', thcMg: 100, priceCents: 2500, inStock: 60 },
    { id: 'p-4', storeId: 'store-2', name: 'Pre-roll 1 g', category: 'pre_roll', netWeightGrams: 1, priceCents: 1200, inStock: 100 },
    { id: 'p-5', storeId: 'store-2', name: 'Ounce of house flower', category: 'flower', netWeightGrams: 28, priceCents: 18000, inStock: 10 },
  ];
  const couriers: Courier[] = [{ id: 'courier-1', name: 'Bay State Couriers', license: lic('MC-DEV-0001', 'courier') }];
  const drivers: Driver[] = [
    { id: 'driver-1', courierId: 'courier-1', name: 'Alex', agentRegistered: true, online: true, agentsInVehicle: 1, vehicle: { make: 'Toyota', model: 'Prius', plate: 'DEV-001' }, lat: 42.355, lng: -71.06, loadCents: 0 },
    { id: 'driver-2', courierId: 'courier-1', name: 'Sam', agentRegistered: true, online: true, agentsInVehicle: 2, vehicle: { make: 'Ford', model: 'Transit', plate: 'DEV-002' }, lat: 42.38, lng: -71.12, loadCents: 0 },
  ];
  const towns: TownRule[] = [
    { town: 'Boston', deliveryAllowed: true },
    { town: 'Cambridge', deliveryAllowed: true, deliveryWindow: { start: '09:00', end: '21:00' } },
    { town: 'Somerville', deliveryAllowed: true },
  ];
  return {
    stores: new Map(stores.map((s) => [s.id, s])),
    products: new Map(products.map((p) => [p.id, p])),
    couriers: new Map(couriers.map((c) => [c.id, c])),
    drivers: new Map(drivers.map((d) => [d.id, d])),
    customers: new Map(),
    orders: new Map(),
    towns,
  };
}

/** Great-circle distance in kilometres. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
