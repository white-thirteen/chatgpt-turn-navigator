import test from 'node:test';
import assert from 'node:assert/strict';
import { activeIndex, itemAtPointer, naturalHeight, visibleHeight, markPosition, railScrollState, scrollToReveal, targetScrollTop } from '../src/core/geometry.js';

test('fixed spacing and natural height handle zero, one, five and 100 turns', () => {
  assert.equal(naturalHeight(0), 0);
  assert.equal(naturalHeight(1), 12);
  assert.equal(naturalHeight(5), 52);
  assert.equal(naturalHeight(100), 1002);
  assert.equal(markPosition(4) - markPosition(3), 10);
  assert.equal(visibleHeight(100, 1000), 420);
  assert.equal(visibleHeight(5, 1000), 52);
  assert.equal(visibleHeight(5, 50), 0);
});
test('pointer hit test clamps bounds, includes rail scroll and rounds exact midpoints up', () => {
  const items = ['one', 'two', 'three'];
  const frame = { getBoundingClientRect: () => ({ top: 100 }) };
  assert.equal(itemAtPointer(items, frame, 0, -1000), 'one');
  assert.equal(itemAtPointer(items, frame, 0, 9999), 'three');
  assert.equal(itemAtPointer(items, frame, 0, 110.99), 'one');
  assert.equal(itemAtPointer(items, frame, 0, 111), 'two');
  assert.equal(itemAtPointer(items, frame, 10, 106), 'two');
  assert.equal(itemAtPointer([], frame, 0, 100), undefined);
});
test('scroll fade has a one pixel tolerance and handles short content', () => {
  const state = top => railScrollState({ scrollTop: top, scrollHeight: 1002, clientHeight: 420 });
  assert.equal(state(1).canScrollUp, false);
  assert.equal(state(1.01).canScrollUp, true);
  assert.equal(state(581).canScrollDown, false);
  assert.equal(state(580.99).canScrollDown, true);
  assert.deepEqual(railScrollState({ scrollTop: 0, scrollHeight: 52, clientHeight: 52 }), { top: 0, canScrollUp: false, canScrollDown: false });
});
test('follow reveals the whole hit area without escaping rail content bounds', () => {
  assert.equal(scrollToReveal(0, 200, 420, 1002), 1);
  assert.equal(scrollToReveal(99, 0, 420, 1002), 581);
  assert.equal(scrollToReveal(20, 0, 420, 1002), 0);
});
test('jump uses viewport-relative rectangles, header offset and content limits', () => {
  assert.equal(targetScrollTop(400, 900, 100, 50, 2000), 1142);
  assert.equal(targetScrollTop(0, 20, 100, 50, 2000), 0);
  assert.equal(targetScrollTop(400, 900, 100, 50, 500), 500);
});
test('active selection skips unloaded turns and uses the last crossed threshold', () => {
  assert.equal(activeIndex([-500, null, 100, 700], 200), 2);
  assert.equal(activeIndex([null, 300, 700], 200), 1);
  assert.equal(activeIndex([-400, -200, 0], 200), 2);
});
