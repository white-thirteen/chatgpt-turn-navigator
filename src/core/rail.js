import css from '../rail.css';
import { itemAtPointer, markPosition, naturalHeight, visibleHeight, railScrollState, scrollToReveal } from './geometry.js';
import { createPreview } from './preview.js';
import { watchTheme } from './theme.js';

export function mountRail({ items = [], activeId = null, onNavigate, container = document.body }) {
  const host = document.createElement('div');
  host.id = 'chatgpt-turn-navigator';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const frame = document.createElement('nav');
  frame.className = 'frame';
  frame.setAttribute('aria-label', '对话轮次导航（已识别的历史）');
  const scroller = document.createElement('div');
  scroller.className = 'scroller';
  const content = document.createElement('div');
  content.className = 'content';
  scroller.append(content);
  frame.append(scroller);
  overlay.append(frame);
  shadow.append(style, overlay);
  container.append(host);
  const stopTheme = watchTheme(host);
  const preview = createPreview(frame);
  const buttons = new Map();
  let layout = { left: 0, top: 0, width: 0, height: 0, band: 0 };
  let pointerInside = false;
  let focusedId = null;
  let pointerId = null;
  let height = 0;
  let destroyed = false;
  let pendingFrame = 0;
  const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function updateFade() {
    const state = railScrollState(scroller);
    scroller.dataset.fade = state.canScrollUp && state.canScrollDown ? 'both' : state.canScrollUp ? 'up' : state.canScrollDown ? 'down' : 'none';
  }
  function paint() {
    const previewId = focusedId || pointerId;
    let selected;
    items.forEach((item, index) => {
      const button = buttons.get(item.id);
      if (!button) return;
      const active = item.id === activeId;
      button.classList.toggle('markActive', active);
      button.classList.toggle('markPreview', !active && item.id === previewId);
      button.classList.toggle('markUnloaded', !item.el);
      button.classList.toggle('markBusy', !!item.streaming);
      if (active) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
      button.setAttribute('aria-busy', String(!!item.streaming));
      button.setAttribute('aria-label', `跳转到第 ${item.turn} 轮${item.el ? '' : '（会加载历史）'}`);
      if (item.id === previewId) {
        button.setAttribute('aria-describedby', preview.id);
        selected = { item, index };
      } else button.removeAttribute('aria-describedby');
    });
    if (selected && !host.hidden) preview.show(selected.item, selected.index, scroller.scrollTop, layout, height);
    else preview.hide();
  }
  function follow() {
    if (pointerInside || focusedId || host.hidden) return;
    const index = items.findIndex(item => item.id === activeId);
    if (index < 0) return;
    const next = scrollToReveal(index, scroller.scrollTop, height, naturalHeight(items.length));
    if (Math.abs(next - scroller.scrollTop) > 0.5) scroller.scrollTo({ top: next, behavior: prefersReducedMotion.matches ? 'instant' : 'smooth' });
  }
  function navigate(item) {
    if (item) Promise.resolve(onNavigate(item)).catch(() => {});
  }
  scroller.addEventListener('pointerenter', () => { pointerInside = true; scroller.scrollTo({ top: scroller.scrollTop, behavior: 'instant' }); });
  scroller.addEventListener('pointermove', event => {
    pointerId = itemAtPointer(items, frame, scroller.scrollTop, event.clientY)?.id || null;
    paint();
  });
  scroller.addEventListener('pointerleave', () => { pointerInside = false; pointerId = null; paint(); follow(); });
  scroller.addEventListener('click', event => {
    // Keyboard activation uses the focused button. Pointer clicks use the rail hit test,
    // even when the pointer falls between a mark and its neighbouring mark.
    const item = event.detail === 0 && event.target.closest('button')
      ? items.find(turn => turn.id === event.target.closest('button').dataset.turnId)
      : itemAtPointer(items, frame, scroller.scrollTop, event.clientY);
    navigate(item);
  });
  scroller.addEventListener('focusin', event => {
    focusedId = event.target.closest('button')?.dataset.turnId || null;
    paint();
  });
  scroller.addEventListener('focusout', event => {
    if (!scroller.contains(event.relatedTarget)) { focusedId = null; paint(); follow(); }
  });
  scroller.addEventListener('keydown', event => {
    const index = items.findIndex(item => item.id === focusedId);
    const next = event.key === 'ArrowDown' ? Math.min(items.length - 1, index + 1)
      : event.key === 'ArrowUp' ? Math.max(0, index - 1)
      : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
    if (next >= 0) {
      event.preventDefault();
      const top = scrollToReveal(next, scroller.scrollTop, height, naturalHeight(items.length));
      scroller.scrollTo({ top, behavior: 'instant' });
      buttons.get(items[next].id)?.focus({ preventScroll: true });
    } else if (event.key === 'Escape') {
      event.target.blur(); pointerId = null; paint();
    }
  });
  scroller.addEventListener('scroll', () => { updateFade(); paint(); }, { passive: true });
  scroller.addEventListener('wheel', event => {
    // Contain wheel input at both ends as well as while the rail can scroll.
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
    scroller.scrollTop += delta;
  }, { passive: false });
  frame.addEventListener('transitionend', () => { updateFade(); follow(); });

  return {
    host,
    update(nextItems, nextActiveId, nextLayout) {
      if (destroyed) return;
      items = nextItems;
      activeId = nextActiveId;
      layout = nextLayout;
      height = visibleHeight(items.length, layout.band);
      host.hidden = items.length < 2 || layout.width <= 900 || height <= 0;
      overlay.style.left = `${layout.left}px`;
      overlay.style.top = `${layout.top}px`;
      overlay.style.width = `${layout.width}px`;
      overlay.style.setProperty('--band', `${layout.band}px`);
      overlay.style.setProperty('--container-width', `${layout.width}px`);
      frame.style.height = `${height}px`;
      content.style.height = `${naturalHeight(items.length)}px`;
      const liveIds = new Set(items.map(item => item.id));
      for (const [id, button] of buttons) {
        if (!liveIds.has(id)) { button.remove(); buttons.delete(id); }
      }
      if (!liveIds.has(focusedId)) focusedId = null;
      if (!liveIds.has(pointerId)) pointerId = null;
      items.forEach((item, index) => {
        let button = buttons.get(item.id);
        if (!button) {
          button = document.createElement('button');
          button.type = 'button';
          button.className = 'mark markNew';
          button.dataset.turnId = item.id;
          button.addEventListener('animationend', () => button.classList.remove('markNew'), { once: true });
          buttons.set(item.id, button);
        }
        button.style.top = `${markPosition(index)}px`;
        // Preserve node identity and focus while reconciling order.
        if (content.children[index] !== button) content.insertBefore(button, content.children[index] || null);
      });
      paint();
      updateFade();
      cancelAnimationFrame(pendingFrame);
      pendingFrame = requestAnimationFrame(() => { updateFade(); follow(); });
    },
    hide() { host.hidden = true; preview.hide(); },
    reset() {
      focusedId = null; pointerId = null; pointerInside = false;
      scroller.scrollTop = 0;
      for (const button of buttons.values()) button.remove();
      buttons.clear();
      preview.hide();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(pendingFrame);
      stopTheme(); preview.destroy(); host.remove(); buttons.clear();
    }
  };
}
