// IPC channel names
export type ChannelName = 
  | 'get-app-path'
  | 'get-user-data-path'
  | 'read-bundled-file'
  | 'shell-open-path'
  | 'child-process';

// IPC payload types
export type ChannelPayload = {
  [key: string]: unknown;
};

// Security levels
export type SecurityLevel = 'safe' | 'restricted' | 'blocked';

// IPC channel entry
export interface IPCChannelEntry {
  name: ChannelName;
  description: string;
  securityLevel: SecurityLevel;
  payloadSchema?: {
    type: string;
    description: string;
    required?: boolean;
  };
}

// Validation result
export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// Error types
export class IPCError extends Error {
  constructor(
    message: string,
    public channel: ChannelName,
    public payload: unknown
  ) {
    super(message);
    this.name = 'IPCError';
  }
}

// Blocked operation error
export class BlockedOperationError extends Error {
  constructor(operation: string) {
    super(`Operation '${operation}' is blocked for security reasons`);
    this.name = 'BlockedOperationError';
  }
}
