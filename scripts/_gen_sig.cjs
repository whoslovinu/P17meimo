const c = require('crypto');
const body = JSON.stringify({
  user_id: 'test_user_002',
  action_type: 'consume',
  amount: 50,
  tx_id: 'tx_repro_002_long_id_xyz',
  timestamp: 1753200001000,
  sign: '0'.repeat(64),
});
const secret = 'YOUR_WEBHOOK_SECRET';
const sig = 'sha256=' + c.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
console.log('BODY=', body);
console.log('SIG=', sig);