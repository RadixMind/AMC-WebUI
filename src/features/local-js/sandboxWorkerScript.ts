/**
 * Self-contained Web Worker code for the JavaScript sandbox.
 * Runs in an isolated thread with dangerous network and storage APIs blocked.
 */
export const SANDBOX_WORKER_SCRIPT = `
const blockedApis = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'indexedDB',
];

for (const api of blockedApis) {
  try {
    Object.defineProperty(self, api, {
      value: undefined,
      writable: false,
      configurable: false,
    });
  } catch (_) {
    // Some worker environment globals may be non-configurable
  }
}

self.onmessage = async (event) => {
  const { id, code, files = {} } = event.data || {};
  if (!id) return;

  const logs = [];
  const serialize = (val) => {
    if (typeof val === 'string') return val;
    if (val instanceof Error) return val.stack || val.message;
    if (val === undefined) return undefined;
    try {
      return JSON.stringify(val, null, 2);
    } catch (_) {
      // Fallback for circular references or BigInt values that cannot be JSON serialized
      return String(val);
    }
  };

  const customConsole = {
    log: (...args) => logs.push(args.map(serialize).join(' ')),
    info: (...args) => logs.push(args.map(serialize).join(' ')),
    warn: (...args) => logs.push('[warn] ' + args.map(serialize).join(' ')),
    error: (...args) => logs.push('[error] ' + args.map(serialize).join(' ')),
  };

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const runner = new AsyncFunction('files', 'console', 'context', code);
    const rawResult = await runner(files, customConsole, { files });

    self.postMessage({
      id,
      status: 'success',
      logs: logs.join('\\n'),
      result: serialize(rawResult),
    });
  } catch (executionError) {
    self.postMessage({
      id,
      status: 'error',
      logs: logs.join('\\n'),
      error: executionError instanceof Error ? (executionError.stack || executionError.message) : String(executionError),
    });
  }
};
`;
