require('dotenv').config();
const cron = require('node-cron');
const { runCrawl } = require('./crawler');

console.log('[scheduler] Starting. Crawler runs every 30 minutes.');
console.log('[scheduler] Running initial crawl now...');

runCrawl().catch(err => console.error('[scheduler] Initial crawl error:', err.message));

cron.schedule('*/30 * * * *', () => {
  console.log(`[scheduler] Triggered at ${new Date().toISOString()}`);
  runCrawl().catch(err => console.error('[scheduler] Cron error:', err.message));
});
