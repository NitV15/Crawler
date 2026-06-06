jest.mock('googleapis');
const { google } = require('googleapis');

const mockUpdate = jest.fn().mockResolvedValue({});

function setupGoogleMock() {
  google.auth = { GoogleAuth: jest.fn().mockImplementation(() => ({ getClient: jest.fn().mockResolvedValue({}) })) };
  google.sheets = jest.fn().mockReturnValue({ spreadsheets: { values: { update: mockUpdate } } });
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  setupGoogleMock();
  process.env.GOOGLE_CREDENTIALS_JSON = JSON.stringify({ type: 'service_account' });
  process.env.SPREADSHEET_ID = 'fake-id';
});

test('syncDealersToSheets calls spreadsheets.values.update with dealers range', async () => {
  setupGoogleMock();
  const { syncDealersToSheets } = require('../sheets-sync');
  const dealers = [{ id: 1, name: 'Co', emails: 'a@b.com', industry: '', description: '', industry_category: '', services: '', target_customers: '', keywords: '', state: '', city: '', service_areas: '', custom_subreddits: '', lead_count: 0, subscription_status: 'free', subscription_expires_at: '', active: 1, created_at: '' }];
  await syncDealersToSheets(dealers);
  await new Promise(r => setTimeout(r, 50));
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ range: 'dealers!A1' }));
});

test('syncCandidatesToSheets calls spreadsheets.values.update with candidates range', async () => {
  setupGoogleMock();
  const { syncCandidatesToSheets } = require('../sheets-sync');
  const candidates = [{ id: 1, name: 'Mitesh', emails: 'm@t.com', role: '', skills: '', experience_level: '', city: '', state: '', preferred_locations: '', lead_count: 0, subscription_status: 'free', subscription_expires_at: '', active: 1, created_at: '' }];
  await syncCandidatesToSheets(candidates);
  await new Promise(r => setTimeout(r, 50));
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ range: 'candidates!A1' }));
});

test('sync is a no-op when credentials not set', async () => {
  delete process.env.GOOGLE_CREDENTIALS_JSON;
  delete process.env.GOOGLE_CREDENTIALS_PATH;
  setupGoogleMock();
  const { syncDealersToSheets } = require('../sheets-sync');
  await syncDealersToSheets([]);
  await new Promise(r => setTimeout(r, 50));
  expect(mockUpdate).not.toHaveBeenCalled();
});
