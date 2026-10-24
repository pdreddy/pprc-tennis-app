/** Trusted business clock. Tests control deadlines without changing Firebase/gRPC's clock. */
export function serverNow() {
  return Date.now();
}
