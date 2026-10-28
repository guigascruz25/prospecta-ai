import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestedModelRates,structuredModelOptions,researchInputReservation} from '../src/lib/openai-model-options';

test('shared budget rates cover the more expensive model, including an existing legacy selection',()=>{
  assert.deepEqual(suggestedModelRates('gpt-6-luna','gpt-5.4-mini'),{input:0.75,output:4.5});
  assert.deepEqual(suggestedModelRates('gpt-5.4-mini-2026-03-17','gpt-5.4-nano-2026-03-17'),{input:0.75,output:4.5});
  assert.deepEqual(suggestedModelRates('gpt-6-luna','gpt-6-luna'),{input:0.1,output:0.5});
});
test('custom model pricing is never invented',()=>{
  assert.equal(suggestedModelRates('my-custom-model','gpt-6-luna'),null);
});
test('Luna structured tasks preserve output room and the full research reservation without imposing options on custom models',()=>{
  assert.deepEqual(structuredModelOptions('gpt-6-luna'),{reasoning:{effort:'none'}});
  assert.deepEqual(structuredModelOptions('gpt-4.1-mini'),{});
  assert.equal(researchInputReservation('gpt-6-luna'),1050000);
  assert.equal(researchInputReservation('gpt-5.4-mini'),400000);
});
