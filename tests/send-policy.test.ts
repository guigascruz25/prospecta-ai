import test from 'node:test';
import assert from 'node:assert/strict';
import {rampedDailyLimit} from '../src/lib/send-policy';
test('operator starting allowance supports ten new contacts and two existing returns within the hard cap',()=>{
  assert.equal(rampedDailyLimit(12,12,'2026-10-14T12:00:00Z',new Date('2026-10-16T12:00:00Z')),12);
  assert.equal(rampedDailyLimit(10,12,'2026-10-14T12:00:00Z',new Date('2026-10-16T12:00:00Z')),10);
});
test('default ramp adds five each week and never exceeds the hard cap',()=>{
  const start='2026-10-01T12:00:00Z';
  assert.equal(rampedDailyLimit(12,5,start,new Date('2026-10-07T12:00:00Z')),5);
  assert.equal(rampedDailyLimit(12,5,start,new Date('2026-10-08T12:00:00Z')),10);
  assert.equal(rampedDailyLimit(12,5,start,new Date('2026-10-15T12:00:00Z')),12);
});
