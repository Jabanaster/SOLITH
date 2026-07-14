import { IN_PROCESS_SCRIPT_MILESTONE } from './charter.js';
import type { InProcessGateInput } from './types.js';

export function evaluateInProcessGate(input: InProcessGateInput): { allowed: boolean; reason: string } {
  if (!input.featureEnabled) {
    return {
      allowed: false,
      reason: 'In-process script execution is disabled. Enable inProcessScriptExecutionEnabled in settings.',
    };
  }
  if (!input.userConfirmedOffline) {
    return { allowed: false, reason: 'User has not confirmed solo / offline play for in-process execution.' };
  }
  if (!input.userApprovedAction) {
    return { allowed: false, reason: 'Explicit user approval is required for this in-process action.' };
  }
  const allowedExe = IN_PROCESS_SCRIPT_MILESTONE.pilotExecutables.some(
    (name) => name.toLowerCase() === input.executableName.toLowerCase(),
  );
  if (!allowedExe) {
    return {
      allowed: false,
      reason: `In-process script execution pilot is limited to ${IN_PROCESS_SCRIPT_MILESTONE.pilotExecutables.join(', ')}.`,
    };
  }
  return { allowed: true, reason: 'ok' };
}
