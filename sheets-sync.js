const { google } = require('googleapis');

let client = null;

const DEALER_COLS = ['id','name','emails','industry','description','industry_category','services','target_customers','keywords','state','city','service_areas','custom_subreddits','lead_count','subscription_status','subscription_expires_at','active','created_at'];
const CANDIDATE_COLS = ['id','name','emails','role','skills','experience_level','city','state','preferred_locations','lead_count','subscription_status','subscription_expires_at','active','created_at'];

async function getClient() {
  if (client) return client;
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) return null;

  let authConfig;
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    authConfig = { credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) };
  } else if (process.env.GOOGLE_CREDENTIALS_PATH) {
    authConfig = { keyFile: process.env.GOOGLE_CREDENTIALS_PATH };
  } else {
    return null;
  }

  const auth = new google.auth.GoogleAuth({ ...authConfig, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const authClient = await auth.getClient();
  client = { sheets: google.sheets({ version: 'v4', auth: authClient }), spreadsheetId };
  return client;
}

async function overwriteSheet(name, cols, rows) {
  const c = await getClient();
  if (!c) return;
  const values = [cols, ...rows.map(r => cols.map(h => String(r[h] ?? '')))];
  await c.sheets.spreadsheets.values.update({
    spreadsheetId: c.spreadsheetId,
    range: `${name}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
}

function syncDealersToSheets(dealers) {
  return overwriteSheet('dealers', DEALER_COLS, dealers)
    .catch(e => console.warn('[sheets-sync] dealers sync failed:', e.message));
}

function syncCandidatesToSheets(candidates) {
  return overwriteSheet('candidates', CANDIDATE_COLS, candidates)
    .catch(e => console.warn('[sheets-sync] candidates sync failed:', e.message));
}

module.exports = { syncDealersToSheets, syncCandidatesToSheets };
