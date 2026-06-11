/**
 * Principal fixtures as SPIFFE IDs across the cross-principal gradient
 * (build brief section 4, test plan section 0). No live SPIRE: these are
 * fixtures, the principal model is exercised, the issuance path is out of
 * scope.
 *
 *   - agent      native
 *   - workload   native
 *   - human      delegated via OIDC -> SPIFFE (identitySource "delegated")
 *   - artefact   identified by its in-toto attestation subject
 *   - device     deliberately partial (principalCoverage "partial"),
 *                not a fifth equal type
 */

export const agentId = 'spiffe://demo/agent/email-helper';
export const workloadId = 'spiffe://demo/workload/etl';
export const humanId = 'spiffe://demo/human/alice';
export const deviceId = 'spiffe://demo/device/laptop-7';

/** A human admitted as a delegated identity, federated OIDC -> SPIFFE. */
export const humanDelegation = {
  principal: humanId,
  identitySource: 'delegated' as const,
  delegatedFrom: 'oidc',
};

/**
 * An artefact represented by its in-toto attestation subject. The principal is
 * the subject string itself (build brief: artefact identified by its in-toto
 * attestation subject).
 */
export const attestation = {
  subject: 'sha256:3f786850e387550fdab836ed7e6dc881de23001b2c5e4f2c3d8a9b0e1f2a3b4c',
  name: 'build-artefact/report.pdf',
};

export const principals = {
  agentId,
  workloadId,
  humanId,
  deviceId,
  humanDelegation,
  attestation,
} as const;
