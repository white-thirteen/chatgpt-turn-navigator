// Geometry, state model and interaction semantics ported from DeepSeek Harness
// packages/client/ui-chat/src/client/chat/TurnNavigator.js
// (c) DeepSeek, MIT License — https://github.com/deepseek-ai/deepseek-harness
// Reimplemented from the supplied specification; upstream source parity is unverified.

export const TURN_SPACING_PX = 10;
export const RAIL_INSET_PX = 6;
export const FADE_PX = 24;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const naturalHeight = count => count > 0 ? (count - 1) * TURN_SPACING_PX + 2 * RAIL_INSET_PX : 0;
export const visibleHeight = (count, band) => Math.min(naturalHeight(count), Math.max(0, band - 64), 420);
export const markPosition = index => index * TURN_SPACING_PX + RAIL_INSET_PX;

export function itemAtPointer(items, frame, scrollTop, clientY) {
  if (!items.length) return undefined;
  const offset = clientY - frame.getBoundingClientRect().top + scrollTop - RAIL_INSET_PX;
  return items[clamp(Math.round(offset / TURN_SPACING_PX), 0, items.length - 1)];
}

export function railScrollState(scroller) {
  const top = scroller.scrollTop;
  return {
    top,
    canScrollUp: top > 1,
    canScrollDown: top < scroller.scrollHeight - scroller.clientHeight - 1
  };
}

export function scrollToReveal(index, top, height, contentHeight) {
  const center = markPosition(index);
  let next = top;
  if (center - 5 < top) next = center - 5;
  else if (center + 5 > top + height) next = center + 5 - height;
  return clamp(next, 0, Math.max(0, contentHeight - height));
}

// Rect coordinates are measured at the same instant, relative to the viewport.
export function targetScrollTop(currentTop, itemTop, viewportTop, headerOffset, maxTop) {
  return clamp(currentTop + itemTop - viewportTop - headerOffset - 8, 0, Math.max(0, maxTop));
}

export function activeIndex(tops, threshold) {
  let found = -1;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] !== null && Number.isFinite(tops[i]) && tops[i] <= threshold) found = i;
  }
  return found >= 0 ? found : Math.max(0, tops.findIndex(Number.isFinite));
}
