export function getCookieValue(
  cookieHeader: string | undefined,
  cookieName: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const segment of cookieHeader.split(';')) {
    const separatorIndex = segment.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const name = segment.slice(0, separatorIndex).trim();

    if (name !== cookieName) {
      continue;
    }

    const encodedValue = segment.slice(separatorIndex + 1).trim();

    try {
      return decodeURIComponent(encodedValue);
    } catch {
      return null;
    }
  }

  return null;
}
