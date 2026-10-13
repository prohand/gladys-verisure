// -----------------------------------------------------------------------------
// Entry point of the Verisure integration for Gladys Assistant.
//
// The Gladys supervisor provides the container with GLADYS_HOST_API_URL,
// GLADYS_INTEGRATION_TOKEN and GLADYS_INTEGRATION_SELECTOR: the SDK reads them,
// `new GladysIntegration()` is enough. All the handlers are registered by
// src/app.js before connect().
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const gladys = new GladysIntegration();
const app = createApp(gladys);

// SIGTERM/SIGINT from the supervisor: stop the refresh loop, then the SDK
// disconnects cleanly and exits 0.
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  app.stop();
});

logger.info('Starting the Verisure integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
