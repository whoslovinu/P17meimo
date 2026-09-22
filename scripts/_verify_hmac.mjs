// scripts/_verify_hmac.mjs — Local HMAC verification of test-team payload
import { createHmac } from 'node:crypto';

const PAYLOAD_STRING = '{"action_type":"consume","amount":40,"sign":"0000000000000000000000000000000000000000000000000000000000000000","timestamp":1785327042150,"tx_id":"CONSUME_8618","user_id":"128"}';
const RECEIVED_SIG = 'fb1b622408b2e72b76a3ab10c80810e655464a620e813d52fb05f4e1686d8362';

// Two candidate secrets
const SERVER_SECRET = 'YOUR_WEBHOOK_SECRET_SERVER'; // current /var/www/app/.env.production
const OFFICIAL_SECRET = 'YOUR_WEBHOOK_SECRET_OFFICIAL'; // spec

function sig(secret, payload) {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

const withServer  = sig(SERVER_SECRET,    PAYLOAD_STRING);
const withOfficial = sig(OFFICIAL_SECRET, PAYLOAD_STRING);

console.log('Payload string (verbatim):');
console.log(' ', PAYLOAD_STRING);
console.log();
console.log('Payload length:', PAYLOAD_STRING.length, 'bytes');
console.log();
console.log('Received sig (from test team):     ', RECEIVED_SIG);
console.log('Computed sig with SERVER_SECRET:   ', withServer);
console.log('Computed sig with OFFICIAL_SECRET: ', withOfficial);
console.log();
console.log('=== Match checks ===');
console.log('Server matches test sig?   ', withServer    === RECEIVED_SIG ? 'YES' : 'NO');
console.log('Official matches test sig? ', withOfficial === RECEIVED_SIG ? 'YES' : 'NO');

// Also show short previews for log
console.log();
console.log('=== Short previews (first 8 hex chars) for log inspection ===');
console.log('  receivedSig[0..8]:  ', RECEIVED_SIG.slice(0, 8));
console.log('  serverSig[0..8]:    ', withServer.slice(0, 8));
console.log('  officialSig[0..8]:  ', withOfficial.slice(0, 8));