import { getCookieValue } from './cookie.util';

describe('getCookieValue', () => {
  it('reads and decodes the selected cookie', () => {
    expect(
      getCookieValue(
        'other=value; refresh_token=token%2Esecret; theme=dark',
        'refresh_token',
      ),
    ).toBe('token.secret');
  });

  it('returns null for a missing or malformed cookie', () => {
    expect(getCookieValue(undefined, 'refresh_token')).toBeNull();
    expect(getCookieValue('other=value', 'refresh_token')).toBeNull();
    expect(
      getCookieValue('refresh_token=%E0%A4%A', 'refresh_token'),
    ).toBeNull();
  });
});
