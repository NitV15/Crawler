const {
  buildEmailText,
  buildExpiryWarningText,
  buildExpiredText,
  buildCandidateExpiryWarningText,
  buildCandidateExpiredText,
} = require('../mailer');

const dealer = { name: 'Test Co', emails: 'a@b.com', industry_category: 'Furniture & Home Decor' };
const post = { title: 'Need wardrobe', text: '', subreddit: 'Faridabad', url: 'http://reddit.com/x', whatToSell: 'modular wardrobe' };

test('buildEmailText includes post title and suggested reply', () => {
  const text = buildEmailText({ dealer, post, suggestedReply: 'We can help!', includeSubscribeFooter: false });
  expect(text).toContain('Need wardrobe');
  expect(text).toContain('We can help!');
});

test('buildEmailText includes subscribe footer when flag is true', () => {
  const text = buildEmailText({
    dealer, post, suggestedReply: 'Hi!',
    includeSubscribeFooter: true, paymentLink: 'http://localhost:3000/pay?dealer_id=1'
  });
  expect(text).toContain("You've used your 2 free leads");
  expect(text).toContain('http://localhost:3000/pay?dealer_id=1');
});

test('buildEmailText omits subscribe footer when flag is false', () => {
  const text = buildEmailText({ dealer, post, suggestedReply: 'Hi!', includeSubscribeFooter: false });
  expect(text).not.toContain("You've used your 2 free leads");
});

test('buildEmailText includes what_to_sell from post', () => {
  const text = buildEmailText({ dealer, post, suggestedReply: 'Hi!', includeSubscribeFooter: false });
  expect(text).toContain('modular wardrobe');
});

const candidate = { name: 'Raj Kumar', emails: 'raj@gmail.com' };

test('buildExpiryWarningText includes dealer name and payment link', () => {
  const text = buildExpiryWarningText(dealer, 'http://localhost:3000/pay?dealer_id=1');
  expect(text).toContain('Test Co');
  expect(text).toContain('http://localhost:3000/pay?dealer_id=1');
  expect(text).toContain('3 days');
});

test('buildExpiredText includes dealer name and payment link', () => {
  const text = buildExpiredText(dealer, 'http://localhost:3000/pay?dealer_id=1');
  expect(text).toContain('Test Co');
  expect(text).toContain('http://localhost:3000/pay?dealer_id=1');
  expect(text).toContain('expired');
});

test('buildCandidateExpiryWarningText includes candidate name and payment link', () => {
  const text = buildCandidateExpiryWarningText(candidate, 'http://localhost:3000/candidate-pay?candidate_id=2');
  expect(text).toContain('Raj Kumar');
  expect(text).toContain('http://localhost:3000/candidate-pay?candidate_id=2');
  expect(text).toContain('3 days');
});

test('buildCandidateExpiredText includes candidate name and payment link', () => {
  const text = buildCandidateExpiredText(candidate, 'http://localhost:3000/candidate-pay?candidate_id=2');
  expect(text).toContain('Raj Kumar');
  expect(text).toContain('http://localhost:3000/candidate-pay?candidate_id=2');
  expect(text).toContain('expired');
});
