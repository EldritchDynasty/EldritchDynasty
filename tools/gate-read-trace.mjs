import fs, { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const traceFile = process.env.ED_GATE_READ_TRACE;
let activeGate = process.env.ED_GATE_ACTIVE || null;

const asPath = (value) => {
  if (typeof value === 'string') return resolve(value);
  if (Buffer.isBuffer(value)) return resolve(value.toString());
  if (value instanceof URL && value.protocol === 'file:') return fileURLToPath(value);
  return null;
};

const record = (value) => {
  if (!traceFile || !activeGate) return;
  const path = asPath(value);
  if (!path) return;
  appendFileSync(traceFile, JSON.stringify({ gate: activeGate, path }) + '\n');
};

const wrap = (object, name) => {
  const original = object[name];
  if (typeof original !== 'function') return;
  object[name] = function (...args) {
    record(args[0]);
    return Reflect.apply(original, this, args);
  };
};

for (const name of [
  'readFile', 'readFileSync',
  'readdir', 'readdirSync',
  'stat', 'statSync',
  'lstat', 'lstatSync',
  'realpath', 'realpathSync',
  'existsSync',
]) {
  wrap(fs, name);
}
for (const name of ['readFile', 'readdir', 'stat', 'lstat', 'realpath']) {
  wrap(fs.promises, name);
}

// Named imports from node:fs are separate live bindings. Synchronise them
// after patching the default export so gate code using either form is traced.
syncBuiltinESMExports();

globalThis.__edGateTrace = {
  start(gate) {
    activeGate = gate;
    process.env.ED_GATE_ACTIVE = gate;
  },
  stop() {
    activeGate = null;
    delete process.env.ED_GATE_ACTIVE;
  },
};
