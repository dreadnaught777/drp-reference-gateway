/**
 * Context-token helpers for Suite I. mutate() tampers a signed context token so
 * its signature no longer matches, modelling a forged carriage token: the
 * gateway must detect this and exclude the token from policy input.
 */

/** Corrupt the signature segment of a base64url(payload).base64url(sig) token,
 * leaving it well-formed but unverifiable. */
export function mutate(token: string): string {
  const dot = token.lastIndexOf('.');
  if (dot === -1) return `${token}x`;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const first = sig.charAt(0);
  const flipped = (first === 'A' ? 'B' : 'A') + sig.slice(1);
  return `${payload}.${flipped}`;
}
