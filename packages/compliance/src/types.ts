export type ProductCategory =
  | 'flower'
  | 'pre_roll'
  | 'concentrate'
  | 'vape'
  | 'edible'
  | 'tincture'
  | 'topical'
  | 'accessory';

export interface CartLine {
  productId: string;
  name: string;
  category: ProductCategory;
  quantity: number;
  /** Net cannabis weight per unit in grams (flower, pre-rolls, concentrates, vapes). */
  netWeightGrams?: number;
  /** Total THC per unit in milligrams (edibles, tinctures). */
  thcMg?: number;
  unitPriceCents: number;
}

export type PlaceType =
  | 'house'
  | 'condo'
  | 'apartment'
  | 'college_housing'
  | 'federal_public_housing'
  | 'hotel'
  | 'business'
  | 'school'
  | 'other';

export interface DeliveryAddress {
  line1: string;
  town: string;
  state: string;
  postalCode: string;
  placeType: PlaceType;
  lat?: number;
  lng?: number;
}

export interface CustomerIdentity {
  /** True only once the customer passed pre-verification (in person or an approved electronic method). */
  preVerified: boolean;
  dateOfBirth: string; // YYYY-MM-DD
  idExpiry: string; // YYYY-MM-DD
  idIssuingState?: string;
}

export interface LicenseRecord {
  number: string;
  type: 'retailer' | 'courier' | 'delivery_operator' | 'medical_treatment_center' | 'microbusiness';
  state: string;
  expiresOn: string; // YYYY-MM-DD
  active: boolean;
}

export interface TownRule {
  town: string;
  deliveryAllowed: boolean;
  /** Narrower window a town set by ordinance, local time HH:MM. */
  deliveryWindow?: { start: string; end: string };
}

export interface StateRules {
  state: string;
  timeZone: string;
  minAgeAdultUse: number;
  /** Max per order, in grams of dry flower or its equivalent. */
  maxOrderDryWeightGrams: number;
  /** How other product types convert to grams of dry flower. */
  equivalents: {
    concentrateGramsPerFlowerGram: number;
    edibleThcMgPerFlowerGram: number;
  };
  /** Categories that do not count toward the possession limit. */
  uncountedCategories: ProductCategory[];
  maxDeliveriesPerConsumerPerDay: number;
  deliveryWindow: { start: string; end: string };
  vehicleValueCapCents: { oneAgent: number; twoOrMoreAgents: number };
  allowedPlaceTypes: PlaceType[];
  requirePreVerification: boolean;
  /** Notes for reviewers: which values still need legal confirmation. */
  unverified: string[];
}

export interface Violation {
  code: string;
  message: string;
}

export interface CheckResult {
  ok: boolean;
  violations: Violation[];
}
