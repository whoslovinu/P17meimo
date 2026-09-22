const c = require('crypto');
const h = c.createHash('sha256').update('128').digest();
h[6] = (h[6] & 0x0f) | 0x50;
h[8] = (h[8] & 0x3f) | 0x80;
const x = h.subarray(0, 16).toString('hex');
console.log(`toUuid("128") = ${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20,32)}`);

const h2 = c.createHash('sha256').update('df7ddce5-490f-530a-9169-f7dd1a0cff49').digest();
h2[6] = (h2[6] & 0x0f) | 0x50;
h2[8] = (h2[8] & 0x3f) | 0x80;
const x2 = h2.subarray(0, 16).toString('hex');
console.log(`toUuid("df7ddce5-490f-530a-9169-f7dd1a0cff49") = ${x2.slice(0,8)}-${x2.slice(8,12)}-${x2.slice(12,16)}-${x2.slice(16,20)}-${x2.slice(20,32)}`);
