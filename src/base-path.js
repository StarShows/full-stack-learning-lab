// Keep browser routes inside this app when mounted below another site's origin.
export function appPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) throw new TypeError('Expected an application-relative absolute path.');
  const prefix = typeof document === 'undefined' ? '' : (document.querySelector('meta[name="app-base-path"]')?.getAttribute('content') || '');
  if (prefix && !/^\/[A-Za-z0-9-]+(?:\/[A-Za-z0-9-]+)*$/.test(prefix)) throw new Error('Invalid application URL prefix.');
  return prefix + path;
}
