import { real } from './real.mjs';

// Boolean arm policy (docs/hybrid-boolean-plan.md section 8, step 7):
//   'hybrid-last' (default): the exact arms of booleanInBend run first; what
//     none of them admits goes to the hybrid corefine+recover Boolean, whose
//     answer is exact, a labelled certified mesh or a named refusal;
//   'exact-only': the exact arms only, with their own refusals (the behaviour
//     before the hybrid was dispatched).
// The default is not written into the normalized policy, so a policy that
// does not select one reads the same as before the field existed.
export const BOOLEAN_POLICIES = Object.freeze(['hybrid-last', 'exact-only']);
export const DEFAULT_BOOLEAN_POLICY = 'hybrid-last';

// Policy is selected before evaluation, independently of a failed operation.
export function normalizeModelingPolicy(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('modelingPolicy must be an object');
  for (const key of Object.keys(value)) if (!['curvedContacts', 'contactCapMm', 'boolean'].includes(key)) throw new TypeError(`Unknown modelingPolicy field '${key}'`);
  const boolean = value.boolean ?? DEFAULT_BOOLEAN_POLICY;
  if (!BOOLEAN_POLICIES.includes(boolean)) throw new TypeError(`Unknown Boolean policy '${boolean}'`);
  const booleanField = boolean === DEFAULT_BOOLEAN_POLICY ? {} : { boolean };
  const curvedContacts = value.curvedContacts ?? 'strict';
  if (curvedContacts === 'strict') {
    if (value.contactCapMm !== undefined) throw new TypeError('contactCapMm requires the tolerated-regularized curved-contact policy');
    return Object.freeze({ curvedContacts, ...booleanField });
  }
  if (curvedContacts !== 'tolerated-regularized') throw new TypeError(`Unknown curved-contact policy '${curvedContacts}'`);
  const contactCapMm = value.contactCapMm;
  if (!Number.isFinite(contactCapMm) || contactCapMm < 0) throw new RangeError('tolerated-regularized requires an explicit finite nonnegative contactCapMm');
  real(contactCapMm); // Reject values outside the native representation.
  return Object.freeze({ curvedContacts, contactCapMm, ...booleanField });
}

export function nativeContactPolicy(policy) {
  const selected = normalizeModelingPolicy(policy);
  return selected.curvedContacts === 'strict' ? { $: 'StrictTransverse' }
    : { $: 'ToleratedRegularized', contact_cap: real(selected.contactCapMm) };
}

// The Boolean arm policy of a (normalized or raw) modeling policy.
export const booleanPolicy = policy => normalizeModelingPolicy(policy ?? {}).boolean ?? DEFAULT_BOOLEAN_POLICY;
