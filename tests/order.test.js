import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeKnownOrder } from '../src/adapters/chatgpt.js';

test('known history can prepend, append and merge without renumbering by DOM identity', () => {
  assert.deepEqual(mergeKnownOrder(['b', 'c'], ['a', 'b']), ['a', 'b', 'c']);
  assert.deepEqual(mergeKnownOrder(['a', 'b'], ['b', 'c', 'd']), ['a', 'b', 'c', 'd']);
  assert.deepEqual(mergeKnownOrder(['a', 'c'], ['a', 'b', 'c']), ['a', 'b', 'c']);
});
test('only observed history is retained; disjoint window is treated as replacement', () => {
  assert.deepEqual(mergeKnownOrder(['a', 'b', 'c'], ['b']), ['a', 'b', 'c']);
  assert.deepEqual(mergeKnownOrder(['a', 'b'], ['x', 'y']), ['x', 'y']);
  assert.deepEqual(mergeKnownOrder([], ['a']), ['a']);
});
