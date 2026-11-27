import type {
  CartLine,
  CheckResult,
  CustomerIdentity,
  DeliveryAddress,
  LicenseRecord,
  StateRules,
  TownRule,
  Violation,
} from './types.js';

const result = (violations: Violation[]): CheckResult => ({ ok: violations.length === 0, violations });

/** Grams of dry flower one cart line counts as toward the order limit. */
export function lineDryWeightGrams(line: CartLine, rules: StateRules): number {
  if (rules.uncountedCategories.includes(line.category)) return 0;
  const { concentrateGramsPerFlowerGram: conc, edibleThcMgPerFlowerGram: edible } = rules.equivalents;
  switch (line.category) {
    case 'flower':
    case 'pre_roll':
      return (line.netWeightGrams ?? 0) * line.quantity;
    case 'concentrate':
    case 'vape':
      return ((line.netWeightGrams ?? 0) / conc) * line.quantity;
    case 'edible':
    case 'tincture':
      return ((line.thcMg ?? 0) / edible) * line.quantity;
    default:
      return 0;
  }
}

export function cartDryWeightGrams(lines: CartLine[], rules: StateRules): number {
  return lines.reduce((sum, l) => sum + lineDryWeightGrams(l, rules), 0);
}

export function cartValueCents(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
}

export function checkCart(lines: CartLine[], rules: StateRules): CheckResult {
  const v: Violation[] = [];
  if (lines.length === 0) v.push({ code: 'cart.empty', message: 'The cart is empty.' });
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1) {
      v.push({ code: 'cart.quantity', message: `Invalid quantity for ${l.name}.` });
    }
    const needsWeight = ['flower', 'pre_roll', 'concentrate', 'vape'].includes(l.category);
    const needsThc = ['edible', 'tincture'].includes(l.category);
    if ((needsWeight && l.netWeightGrams == null) || (needsThc && l.thcMg == null)) {
      v.push({ code: 'cart.missing_potency', message: `${l.name} is missing the weight or THC needed to apply limits.` });
    }
  }
  const grams = cartDryWeightGrams(lines, rules);
  if (grams > rules.maxOrderDryWeightGrams + 1e-9) {
    v.push({
      code: 'cart.over_limit',
      message: `This order counts as ${grams.toFixed(1)} g of flower; the limit is ${rules.maxOrderDryWeightGrams.toFixed(1)} g.`,
    });
  }
  return result(v);
}

/** YYYY-MM-DD in the given time zone. */
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value);
  const m = Number(parts.find((p) => p.type === 'minute')?.value);
  return h * 60 + m;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Whole years between a YYYY-MM-DD birth date and a YYYY-MM-DD day. */
export function ageOn(dateOfBirth: string, day: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number);
  const [y, m, d] = day.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

export function checkCustomer(c: CustomerIdentity, rules: StateRules, now = new Date()): CheckResult {
  const v: Violation[] = [];
  const today = localDate(now, rules.timeZone);
  if (rules.requirePreVerification && !c.preVerified) {
    v.push({ code: 'customer.not_verified', message: 'ID must be verified before the first delivery.' });
  }
  if (ageOn(c.dateOfBirth, today) < rules.minAgeAdultUse) {
    v.push({ code: 'customer.underage', message: `Customer must be ${rules.minAgeAdultUse} or older.` });
  }
  if (c.idExpiry < today) v.push({ code: 'customer.id_expired', message: 'The ID on file has expired.' });
  return result(v);
}

export function checkAddress(a: DeliveryAddress, rules: StateRules, towns: TownRule[]): CheckResult {
  const v: Violation[] = [];
  if (a.state.toUpperCase() !== rules.state) {
    v.push({ code: 'address.out_of_state', message: `Delivery is only available inside ${rules.state}.` });
  }
  if (!rules.allowedPlaceTypes.includes(a.placeType)) {
    v.push({ code: 'address.place_type', message: 'Delivery is only allowed to a house, condo or apartment.' });
  }
  const town = towns.find((t) => t.town.toLowerCase() === a.town.toLowerCase());
  if (!town || !town.deliveryAllowed) {
    v.push({ code: 'address.town', message: `${a.town} does not allow cannabis delivery.` });
  }
  return result(v);
}

export function checkDeliveryTime(now: Date, rules: StateRules, town?: TownRule): CheckResult {
  const window = town?.deliveryWindow ?? rules.deliveryWindow;
  // A town may narrow the window but never widen it.
  const start = Math.max(toMinutes(window.start), toMinutes(rules.deliveryWindow.start));
  const end = Math.min(toMinutes(window.end), toMinutes(rules.deliveryWindow.end));
  const t = localMinutes(now, rules.timeZone);
  return result(
    t >= start && t < end
      ? []
      : [{ code: 'time.outside_window', message: `Deliveries run ${window.start} to ${window.end} local time.` }],
  );
}

export function checkDailyLimit(deliveriesToday: number, rules: StateRules): CheckResult {
  return result(
    deliveriesToday >= rules.maxDeliveriesPerConsumerPerDay
      ? [{ code: 'customer.daily_limit', message: 'Only one delivery per customer per day is allowed.' }]
      : [],
  );
}

export function checkVehicleLoad(
  currentLoadCents: number,
  orderValueCents: number,
  agentsInVehicle: number,
  rules: StateRules,
): CheckResult {
  const cap =
    agentsInVehicle >= 2 ? rules.vehicleValueCapCents.twoOrMoreAgents : rules.vehicleValueCapCents.oneAgent;
  const v: Violation[] = [];
  if (agentsInVehicle < 1) v.push({ code: 'vehicle.no_agent', message: 'A registered agent must be in the vehicle.' });
  if (currentLoadCents + orderValueCents > cap) {
    v.push({ code: 'vehicle.over_cap', message: `This would put more than $${cap / 100} of product in the vehicle.` });
  }
  return result(v);
}

export function checkLicense(l: LicenseRecord, rules: StateRules, now = new Date()): CheckResult {
  const v: Violation[] = [];
  if (!l.active) v.push({ code: 'license.inactive', message: `License ${l.number} is not active.` });
  if (l.state.toUpperCase() !== rules.state) {
    v.push({ code: 'license.state', message: `License ${l.number} is not a ${rules.state} license.` });
  }
  if (l.expiresOn < localDate(now, rules.timeZone)) {
    v.push({ code: 'license.expired', message: `License ${l.number} has expired.` });
  }
  return result(v);
}

export interface OrderContext {
  rules: StateRules;
  lines: CartLine[];
  customer: CustomerIdentity;
  address: DeliveryAddress;
  towns: TownRule[];
  deliveriesToday: number;
  sellerLicense: LicenseRecord;
  now?: Date;
}

/** Every check an order must pass before it can be placed. */
export function evaluateOrder(ctx: OrderContext): CheckResult {
  const now = ctx.now ?? new Date();
  const town = ctx.towns.find((t) => t.town.toLowerCase() === ctx.address.town.toLowerCase());
  const all = [
    checkCart(ctx.lines, ctx.rules),
    checkCustomer(ctx.customer, ctx.rules, now),
    checkAddress(ctx.address, ctx.rules, ctx.towns),
    checkDeliveryTime(now, ctx.rules, town),
    checkDailyLimit(ctx.deliveriesToday, ctx.rules),
    checkLicense(ctx.sellerLicense, ctx.rules, now),
  ];
  return result(all.flatMap((r) => r.violations));
}
