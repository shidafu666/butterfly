export function ssoErrorMessage(
  t: (key: string) => string,
  code: string | null | undefined,
): string {
  const knownCodes = new Set(['provider', 'state', 'exchange', 'tenant', 'disabled', 'config']);
  return t(`login.ssoErrors.${knownCodes.has(code ?? '') ? code : 'generic'}`);
}
