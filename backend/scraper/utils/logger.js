'use strict';

const util = require('util');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Minimal structured logger.
 *
 * Emits one JSON object per line so output can be piped into log
 * ingestion/query tools as-is. NEVER log passwords, cookies, auth tokens
 * or other secrets.
 *
 * Usage:
 *   logger.info({ source, route: 'DEL-BOM' }, 'Scrape finished');
 *   logger.info('Scrape finished', { source });
 */
function createLogger(level = 'info') {
  let currentLevel = LEVELS[level] ?? LEVELS.info;

  function write(entryLevel, message, fields) {
    if (LEVELS[entryLevel] < currentLevel) return;

    const record = {
      ts: new Date().toISOString(),
      level: entryLevel.toUpperCase(),
      msg: message
    };

    if (fields && typeof fields === 'object') {
      Object.assign(record, redact(fields));
    }

    const line =
      entryLevel === 'error' ? process.stderr : process.stdout;

    // Format key=value fields for human-side readability while keeping it
    // parseable; values serialized safely.
    const fieldText = Object.keys(record)
      .filter((k) => !['ts', 'level', 'msg'].includes(k))
      .map((k) => `${k}=${serialize(record[k])}`)
      .join(' ');

    const prefix = `[${record.level}]`;
    line.write(
      `${prefix} ${fieldText ? fieldText + ' ' : ''}${message || ''}\n`
    );
  }

  return {
    setLevel(lvl) {
      currentLevel = LEVELS[lvl] ?? currentLevel;
    },
    debug(message, fields) {
      write('debug', message, fields);
    },
    info(message, fields) {
      write('info', message, fields);
    },
    warn(message, fields) {
      write('warn', message, fields);
    },
    error(message, fields) {
      write('error', message, fields);
    }
  };
}

function redact(fields) {
  const SECRET_KEYS = /(password|passwd|token|secret|api[_-]?key|cookie|authorization|session)/i;
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEYS.test(key)) {
      out[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      out[key] = redact(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function serialize(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return util.inspect(value);
}

module.exports = createLogger(process.env.LOG_LEVEL || 'info');
module.exports.createLogger = createLogger;