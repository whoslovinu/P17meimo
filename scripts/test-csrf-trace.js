// Mimics Edge middleware where request.url = http://localhost:3000/api/admin/...
const request = {
  url: 'http://localhost:3000/api/admin/change-password',
  method: 'POST',
  headers: {
    get: (name) => {
      const h = {
        'origin': 'http://98.93.252.250:3000',
        'host': '98.93.252.250',
        'content-type': 'application/json',
        'cookie': 'admin_token=...'
      };
      return h[name.toLowerCase()] ?? null;
    }
  }
};

const hostnameOf = (origin) => {
  try { return new URL(origin).hostname.toLowerCase(); } catch { return ''; }
};
const hostnameMatches = (a, b) => {
  const ha = hostnameOf(a);
  const hb = hostnameOf(b);
  return ha.length > 0 && ha === hb;
};

const requestOrigin = (() => {
  try { return new URL(request.url).origin; } catch { return ''; }
})();
const incomingHostHeader = request.headers.get('host') ?? '';
const headerOrigin = request.headers.get('origin');

console.log('requestOrigin:', requestOrigin);
console.log('incomingHostHeader:', incomingHostHeader);
console.log('headerOrigin:', headerOrigin);
console.log('hostnameOf(headerOrigin):', hostnameOf(headerOrigin));
console.log('hostnameOf(http://' + incomingHostHeader + '):', hostnameOf('http://' + incomingHostHeader));
console.log('hostnameMatches:', hostnameMatches(headerOrigin, 'http://' + incomingHostHeader));
