const MAX_LOGS = 500;
const logs = [];
const subscribers = new Set();

function addLog(level, args) {
  const entry = {
    t: new Date().toISOString(),
    level,
    msg: args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
  };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  for (const fn of subscribers) fn(entry);
}

function getLogs() {
  return [...logs];
}

function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// Intercept console so all modules get captured automatically
const _log = console.log.bind(console);
const _warn = console.warn.bind(console);
const _error = console.error.bind(console);

console.log = (...a) => { _log(...a); addLog('info', a); };
console.warn = (...a) => { _warn(...a); addLog('warn', a); };
console.error = (...a) => { _error(...a); addLog('error', a); };

module.exports = { getLogs, subscribe };
