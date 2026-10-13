export interface SurgeryRequestKey {
  fingerprint: string;
  key: string;
}
export function identifySurgeryRequest(
  payload: unknown,
  previous: SurgeryRequestKey | null,
): SurgeryRequestKey {
  const fingerprint = JSON.stringify(payload);
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, key: crypto.randomUUID() };
}
