const nodemailer = require('nodemailer');
const { sendLeadEmail } = require('../mailer');

jest.mock('nodemailer');

describe('sendLeadEmail', () => {
  const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });

  beforeEach(() => {
    jest.clearAllMocks();
    nodemailer.createTransport.mockReturnValue({ sendMail: mockSendMail });
    process.env.SMTP_USER = 'bot@gmail.com';
    process.env.SMTP_PASS = 'secret';
  });

  test('sends one email to all dealer addresses', async () => {
    await sendLeadEmail({
      dealer: { name: 'Nitin Tanwar', industry: 'Travel', emails: 'a@test.com,b@test.com' },
      post: { title: 'I love travelling', text: '', subreddit: 'india', url: 'https://reddit.com/r/india/abc' },
      matchReason: 'User expressed travel interest',
      suggestedReply: 'We offer great travel packages!',
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.to).toBe('a@test.com, b@test.com');
    expect(mail.subject).toContain('Travel');
    expect(mail.subject).toContain('🎯');
    expect(mail.text).toContain('https://reddit.com/r/india/abc');
    expect(mail.text).toContain('User expressed travel interest');
    expect(mail.text).toContain('We offer great travel packages!');
  });

  test('uses post text when title is empty', async () => {
    await sendLeadEmail({
      dealer: { name: 'Test', industry: 'Gym', emails: 'x@test.com' },
      post: { title: '', text: 'Looking to buy gym equipment', subreddit: 'entrepreneur', url: 'https://reddit.com/r/entrepreneur/xyz' },
      matchReason: 'Gym equipment buyer',
      suggestedReply: 'Check our catalogue!',
    });

    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.text).toContain('Looking to buy gym equipment');
  });
});
