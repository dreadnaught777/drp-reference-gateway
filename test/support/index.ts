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

export { defaultCedarBundle, emptyBundle } from './bundles';
export { proposal, readFileProposal, writeFileProposal } from './proposals';

export { principals } from '../../fixtures/principals';
