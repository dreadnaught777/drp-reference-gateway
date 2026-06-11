/**
 * A stub model so the suite runs with no real LLM key (test plan section 0).
 * The gateway's job is gating declared actions, which does not require live
 * inference; tests that need a model use this deterministic stand-in.
 */

export interface StubModel {
  /** Returns a canned completion. Deterministic: same prompt, same output. */
  complete(prompt: string): Promise<string>;
}

export function stubModel(canned: Record<string, string> = {}): StubModel {
  return {
    async complete(prompt: string): Promise<string> {
      return canned[prompt] ?? 'stub-model-response';
    },
  };
}
