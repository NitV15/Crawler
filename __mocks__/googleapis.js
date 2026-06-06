// Manual mock for googleapis — returns a stable singleton so that
// jest.resetModules() in test beforeEach doesn't break mock isolation.
// The `google` object is stored globally so setupGoogleMock() in tests
// always modifies the same instance that sheets-sync.js uses.

if (!global.__mockGoogleApis) {
  global.__mockGoogleApis = {
    auth: {},
    sheets: jest.fn(),
  };
}

module.exports = {
  google: global.__mockGoogleApis,
};
