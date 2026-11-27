import type { StateRules } from '../types.js';

const OUNCE_GRAMS = 28.3495;

/**
 * Massachusetts adult-use home delivery, 935 CMR 500.145.
 * Source: https://www.law.cornell.edu/regulations/massachusetts/935-CMR-500-145
 * Values listed in `unverified` must be confirmed by Massachusetts counsel before launch.
 */
export const massachusetts: StateRules = {
  state: 'MA',
  timeZone: 'America/New_York',
  minAgeAdultUse: 21,
  // "An Individual Order may not exceed one ounce of Marijuana or its dry-weight equivalent."
  maxOrderDryWeightGrams: OUNCE_GRAMS,
  equivalents: {
    // Placeholder: 1 oz flower = 5 g concentrate.
    concentrateGramsPerFlowerGram: 5 / OUNCE_GRAMS,
    // Placeholder: 1 oz flower = 5,000 mg THC in edibles.
    edibleThcMgPerFlowerGram: 5000 / OUNCE_GRAMS,
  },
  uncountedCategories: ['accessory', 'topical'],
  // One delivery per consumer per residence per calendar day.
  maxDeliveriesPerConsumerPerDay: 1,
  // "All deliveries shall be completed between 7:00 A.M. to 11:00 P.M. local time."
  deliveryWindow: { start: '07:00', end: '23:00' },
  // $5,000 retail value with one agent, $10,000 with two.
  vehicleValueCapCents: { oneAgent: 500_000, twoOrMoreAgents: 1_000_000 },
  // Residences only; not college housing or federal public housing.
  allowedPlaceTypes: ['house', 'condo', 'apartment'],
  requirePreVerification: true,
  unverified: [
    'equivalents.concentrateGramsPerFlowerGram (placeholder: 5 g concentrate per ounce)',
    'equivalents.edibleThcMgPerFlowerGram (placeholder: 5,000 mg THC per ounce)',
    'uncountedCategories (topicals)',
  ],
};
