/**
 * TrainerHost event loop — runs inside the child process.
 *
 * Wires a LineFramer to injected stdin/stdout and dispatches RPC requests
 * to the capability registry. Pure logic: no real process.stdin/stdout
 * references here so tests can drive it with fake streams.
 *
 * Protocol:
 *   - On startup the host sends a handshake response with id "handshake".
 *   - Capability calls: request { id, method, params }
 *                       response { id, ok: true, result } or { id, ok: false, error }
 *   - Shutdown: request { id, method: 'shutdown' } → response, then exit.
 *   - Unknown method: { id, ok: false, error: 'unknown_method' }
 *   - Parent loss (stdin end/close) triggers process.exit(0).
 *
 * Capabilities:
 *   readSaveField         — read a single field from an XML save
 *   proposeWriteField     — validate a write without mutating the file
 *   executeWriteField     — backup + atomic write + verify (requires prior proposal approval from main process)
 *   rollbackWriteField    — atomic restore from backup + verify
 */

import { LineFramer, RpcFrameError, encodeResponse, encodeError, isRpcRequest } from './protocol';
import { readSaveField } from './read-save-field';
import { proposeWriteField, executeWriteField, rollbackWriteField } from './write-save-field';

export const PROTOCOL_VERSION = 1;
export const ADVERTISED_CAPABILITIES = [
  'readSaveField',
  'proposeWriteField',
  'executeWriteField',
  'rollbackWriteField',
] as const;

export interface HostIO {
  stdin: {
    on(event: 'data', cb: (chunk: Buffer) => void): unknown;
    on(event: 'end', cb: () => void): unknown;
    on(event: 'close', cb: () => void): unknown;
  };
  stdout: {
    write(data: string): void;
  };
  exit(code: number): void;
}

export function startHostRuntime(io: HostIO): void {
  const framer = new LineFramer();

  // Send handshake immediately
  io.stdout.write(
    encodeResponse('handshake', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: ADVERTISED_CAPABILITIES,
    }),
  );

  io.stdin.on('data', (chunk: Buffer) => {
    let messages;
    try {
      messages = framer.push(chunk);
    } catch (e) {
      if (e instanceof RpcFrameError) {
        process.stderr.write(`[trainer-host] frame error: ${e.message}\n`);
        return;
      }
      throw e;
    }

    for (const msg of messages) {
      if (!isRpcRequest(msg)) continue;

      const { id, method, params } = msg;

      if (method === 'shutdown') {
        io.stdout.write(encodeResponse(id, { ok: true }));
        io.exit(0);
        return;
      }

      if (method === 'readSaveField') {
        readSaveField(params)
          .then(result => io.stdout.write(encodeResponse(id, result)))
          .catch(err => io.stdout.write(encodeError(id, String(err))));
        continue;
      }

      if (method === 'proposeWriteField') {
        proposeWriteField(params)
          .then(result => io.stdout.write(encodeResponse(id, result)))
          .catch(err => io.stdout.write(encodeError(id, String(err))));
        continue;
      }

      if (method === 'executeWriteField') {
        executeWriteField(params)
          .then(result => io.stdout.write(encodeResponse(id, result)))
          .catch(err => io.stdout.write(encodeError(id, String(err))));
        continue;
      }

      if (method === 'rollbackWriteField') {
        rollbackWriteField(params)
          .then(result => io.stdout.write(encodeResponse(id, result)))
          .catch(err => io.stdout.write(encodeError(id, String(err))));
        continue;
      }

      io.stdout.write(encodeError(id, 'unknown_method'));
    }
  });

  const onParentLost = (): void => io.exit(0);
  io.stdin.on('end', onParentLost);
  io.stdin.on('close', onParentLost);
}
