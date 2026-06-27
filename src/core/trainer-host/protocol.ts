/**
 * JSON-RPC framing for the TrainerHost stdio channel.
 *
 * One JSON object per line (newline-delimited). The LineFramer accumulates
 * partial chunks from stdin and emits complete RpcMessage objects as each
 * newline arrives. Malformed JSON throws RpcFrameError so the caller can
 * reject the pending request without crashing.
 *
 * OWNERSHIP: Pure logic — no I/O, no Electron. Tested in-process.
 */

// ── Envelope types ────────────────────────────────────────────────────────────

export interface RpcRequest {
  id: string;
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  id: string;
  ok: true;
  result: unknown;
}

export interface RpcError {
  id: string;
  ok: false;
  error: string;
}

export type RpcMessage = RpcRequest | RpcResponse | RpcError;

// ── Encode helpers ────────────────────────────────────────────────────────────

export function encodeRequest(id: string, method: string, params?: unknown): string {
  const msg: RpcRequest = params !== undefined ? { id, method, params } : { id, method };
  return JSON.stringify(msg) + '\n';
}

export function encodeResponse(id: string, result: unknown): string {
  const msg: RpcResponse = { id, ok: true, result };
  return JSON.stringify(msg) + '\n';
}

export function encodeError(id: string, error: string): string {
  const msg: RpcError = { id, ok: false, error };
  return JSON.stringify(msg) + '\n';
}

// ── Type guards ───────────────────────────────────────────────────────────────

export function isRpcRequest(m: RpcMessage): m is RpcRequest {
  return 'method' in m;
}

export function isRpcResponse(m: RpcMessage): m is RpcResponse {
  return 'ok' in m && (m as RpcResponse).ok === true;
}

export function isRpcError(m: RpcMessage): m is RpcError {
  return 'ok' in m && (m as RpcError).ok === false;
}

// ── Frame error ───────────────────────────────────────────────────────────────

export class RpcFrameError extends Error {
  constructor(
    public readonly rawLine: string,
    cause: unknown,
  ) {
    super(`RPC frame error: ${String(cause)}`);
    this.name = 'RpcFrameError';
  }
}

// ── LineFramer ────────────────────────────────────────────────────────────────

/**
 * Buffers partial stdin chunks and emits complete RpcMessage objects each
 * time a newline is encountered. Throws RpcFrameError on malformed JSON.
 *
 * Usage:
 *   const framer = new LineFramer();
 *   process.stdin.on('data', chunk => {
 *     for (const msg of framer.push(chunk)) { handle(msg); }
 *   });
 */
export class LineFramer {
  private buf = '';

  push(chunk: Buffer | string): RpcMessage[] {
    this.buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const messages: RpcMessage[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        throw new RpcFrameError(line, e);
      }
      messages.push(parsed as RpcMessage);
    }
    return messages;
  }

  /** Number of buffered bytes not yet flushed (for diagnostics). */
  get bufferedBytes(): number {
    return this.buf.length;
  }
}
