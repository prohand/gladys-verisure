// -----------------------------------------------------------------------------
// Detailed logs, switchable from the Configuration screen.
//
// The SDK logger re-reads `LOG_LEVEL` on every line, so writing the variable
// is enough: it takes effect at once, for every logger already created. A
// level set on the container by the operator is the baseline, put back when
// the switch goes off.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'logging' });

/** `LOG_LEVEL` as the container was started with. */
const BASELINE = process.env.LOG_LEVEL;

/**
 * @param {{ debug_logs: boolean }} config
 * @returns {string} the level in force afterwards
 */
export function applyLogLevel(config) {
  const wanted = config?.debug_logs ? 'debug' : BASELINE;
  const current = process.env.LOG_LEVEL;
  if (wanted === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = wanted;
  }
  if (current !== process.env.LOG_LEVEL) {
    logger.info(`Log level: ${process.env.LOG_LEVEL ?? 'info'}`);
  }
  return process.env.LOG_LEVEL ?? 'info';
}
