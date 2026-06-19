// Tiny structured JSON logger. Keeps the production artifact a single bundled
// file with zero deps; swap for pino later behind this same interface if needed.
type Fields = Record<string, unknown>;

function emit(level: string, msg: string, fields?: Fields): void {
  const line = JSON.stringify({ t: Date.now(), level, msg, ...fields });
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  info: (msg: string, fields?: Fields) => emit('info', msg, fields),
  warn: (msg: string, fields?: Fields) => emit('warn', msg, fields),
  error: (msg: string, fields?: Fields) => emit('error', msg, fields),
};
