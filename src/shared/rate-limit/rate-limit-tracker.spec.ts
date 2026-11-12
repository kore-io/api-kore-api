import { rateLimitTracker } from './rate-limit-tracker';

describe('rateLimitTracker', () => {
  it.each([
    ['200.1.2.3', '200.1.2.3'],
    ['::ffff:200.1.2.3', '200.1.2.3'],
    ['2001:db8:abcd:12:1:2:3:4', '2001:db8:abcd:12::/64'],
    ['2001:db8:abcd:12::99', '2001:db8:abcd:12::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['', 'unknown'],
  ])('dado o IP "%s", quando conta, então usa %s', (ip, expected) => {
    expect(rateLimitTracker({ ip })).toBe(expected);
  });
});
