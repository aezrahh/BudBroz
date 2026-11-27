import type { StateRules } from '../types.js';
import { massachusetts } from './ma.js';

const registry: Record<string, StateRules> = { MA: massachusetts };

export function rulesFor(state: string): StateRules {
  const rules = registry[state.toUpperCase()];
  if (!rules) throw new Error(`No delivery rules configured for state ${state}`);
  return rules;
}

export function supportedStates(): string[] {
  return Object.keys(registry);
}

export { massachusetts };
