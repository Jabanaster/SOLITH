import { parentPort } from 'node:worker_threads';
import { handleHeadlessVerificationMessage } from './headless-verification.js';

const workerParentPort = parentPort;

if (!workerParentPort) {
  throw new Error('headless-verification-worker must run inside a worker thread.');
}

workerParentPort.on('message', (message: unknown) => {
  void (async () => {
    const response = await handleHeadlessVerificationMessage(message);
    workerParentPort.postMessage(response);
  })();
});
