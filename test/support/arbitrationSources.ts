/**
 * Named policy sources for the arbitration suite (Suite G). Within one
 * vocabulary, 'lenient' allows and 'strict' denies the same proposal, so the
 * resolvers have a real disagreement to settle. 'cedar-policy' and
 * 'foreign-framework-X' carry DIFFERENT vocabularies, so a request naming both
 * is the cross-framework case the gateway rejects.
 */

import type { PolicyBundle } from '../../src/types';

const VOCAB = 'drp-demo-v1';

// Permits everything - any proposal evaluates to allow.
const lenientSource = 'permit ( principal, action, resource );\n';

const lenient: PolicyBundle = {
  bundleVersion: 'sha256:source-lenient',
  vocabulary: VOCAB,
  engine: 'cedar',
  source: lenientSource,
  rules: [],
};

// No permits - default-deny denies everything.
const strict: PolicyBundle = {
  bundleVersion: 'sha256:source-strict',
  vocabulary: VOCAB,
  engine: 'cedar',
  source: '',
  rules: [],
};

// Same vocabulary as the demo policy; stands in for the live Cedar source.
const cedarPolicy: PolicyBundle = {
  bundleVersion: 'sha256:source-cedar-policy',
  vocabulary: VOCAB,
  engine: 'cedar',
  source: lenientSource,
  rules: [],
};

// A different framework vocabulary entirely - never evaluated, because a
// request mixing it with a drp-demo-v1 source is rejected first.
const foreignFrameworkX: PolicyBundle = {
  bundleVersion: 'sha256:source-foreign-x',
  vocabulary: 'foreign-framework-x',
  engine: 'cedar',
  source: '',
  rules: [],
};

export const arbitrationSources: Record<string, PolicyBundle> = {
  lenient,
  strict,
  'cedar-policy': cedarPolicy,
  'foreign-framework-X': foreignFrameworkX,
};
