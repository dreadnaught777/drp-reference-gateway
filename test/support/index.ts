/**
 * Test support barrel (test plan section 0). One place to import the harness
 * the suites build on: createGateway, the two stub MCP servers, verifyReceipt,
 * committedSpec, and the stub model.
 */

export { createGateway } from './createGateway';
export type {
  CreateGatewayOptions,
  GatewayClient,
  GatewayHandle,
  PublishedKey,
  EffectivePolicy,
  AssumedState,
  ReconcileReport,
  EscalationResolution,
} from './createGateway';

export { stubMcpServer } from './stubMcpServer';
export type { StubMcpServer, RecordedCall } from './stubMcpServer';

export { verifyReceipt } from './verifyReceipt';
export type { PublicKeyInput } from './verifyReceipt';

export { committedSpec } from './committedSpec';
export type { OpenApiDoc } from './committedSpec';

export { stubModel } from './stubModel';
export type { StubModel } from './stubModel';

export {
  defaultCedarBundle,
  defaultOpaBundle,
  defaultBundleFor,
  emptyBundle,
  stricterPolicy,
  tightenEgress,
  contradictoryCedar,
  loadRecordedTraffic,
} from './bundles';
export {
  proposal,
  readFileProposal,
  writeFileProposal,
  deleteFileProposal,
  egressProposal,
  readCrmProposal,
  sendExternalProposal,
  artefactWriteProposal,
  artefactReadProposal,
  artefactAdmission,
  proposalAnomalousVsOtherPrincipal,
  declaredBenignProposal,
  p1,
  p2,
} from './proposals';
export { deceptiveTool, readReportedMetrics } from './honesty';
export type { ReportedMetric } from './honesty';
export {
  validateOpenApi,
  validateAgainstSpec,
  protocolSamples,
  READBACK_CONFORMANT_PATHS,
} from './conformance';
export {
  sharedScenarioSet,
  expectedDecision,
  t0,
  t1,
  t2,
  ALLOWLISTED,
  PROTECTED_DATA,
} from './scenarios';
export { mutate } from './context';
export { arbitrationSources } from './arbitrationSources';
export { hash, jcs, sampleA, reorderKeys } from './receiptHelpers';
export { createOtelHarness } from './otel';
export type { OtelHarness, RecordedEvent } from './otel';

export { principals } from '../../fixtures/principals';
