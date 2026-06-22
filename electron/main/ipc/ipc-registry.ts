import type { ChannelName } from '../api-types';

// IPC channel registry - all channels must be registered here
export const IPC_REGISTRY = {
  // App paths
  'get-app-path': {
    name: 'get-app-path',
    description: 'Get application path',
    securityLevel: 'safe',
    payloadSchema: null, // No payload
  },
  'get-user-data-path': {
    name: 'get-user-data-path',
    description: 'Get user data path',
    securityLevel: 'safe',
    payloadSchema: null,
  },

  // Bundled file reading
  'read-bundled-file': {
    name: 'read-bundled-file',
    description: 'Read bundled file from app directory',
    securityLevel: 'restricted',
    payloadSchema: {
      type: 'string',
      description: 'Relative file path from app directory',
      required: true,
    },
  },

  // Blocked operations
  'shell-open-path': {
    name: 'shell-open-path',
    description: 'Open file in shell (BLOCKED)',
    securityLevel: 'blocked',
    payloadSchema: {
      type: 'string',
      description: 'File path to open',
      required: true,
    },
  },
  'child-process': {
    name: 'child-process',
    description: 'Execute child process (BLOCKED)',
    securityLevel: 'blocked',
    payloadSchema: {
      type: 'string',
      description: 'Command to execute',
      required: true,
    },
  },
};

// Validate an IPC channel exists
export function validateChannel(channel: ChannelName): boolean {
  return Object.values(IPC_REGISTRY).some(
    (entry) => entry.name === channel
  );
}

// Get channel info
export function getChannelInfo(channel: ChannelName) {
  return Object.values(IPC_REGISTRY).find(
    (entry) => entry.name === channel
  );
}

// Validate payload against schema
export function validatePayload(
  channel: ChannelName,
  payload: unknown
): boolean {
  const channelInfo = getChannelInfo(channel);
  if (!channelInfo) {
    return false;
  }

  // Blocked channels always fail
  if (channelInfo.securityLevel === 'blocked') {
    return false;
  }

  // Simple validation - in production, use proper JSON schema validation
  if (channelInfo.payloadSchema) {
    if (typeof payload !== channelInfo.payloadSchema.type) {
      return false;
    }
  }

  return true;
}

// Validate channel and payload before sending
export function validateIPCRequest(channel: ChannelName, payload: unknown): {
  valid: boolean;
  reason?: string;
} {
  if (!validateChannel(channel)) {
    return { valid: false, reason: 'Unknown channel' };
  }

  if (!validatePayload(channel, payload)) {
    return { valid: false, reason: 'Invalid payload' };
  }

  return { valid: true };
}
