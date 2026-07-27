export interface FreezeAuditSink {
  append(entry: Record<string, unknown>): void;
}

export function appendFreezeAuditWithFallback(
  bundleAudit: FreezeAuditSink | undefined,
  fallbackAudit: FreezeAuditSink,
  entry: Record<string, unknown>,
): void {
  (bundleAudit ?? fallbackAudit).append(entry);
}
