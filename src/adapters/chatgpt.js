import { targetScrollTop } from '../core/geometry.js';

const USER = '[data-message-author-role="user"], [data-content-search-unit-key$=":user"]';
const ASSISTANT = '[data-message-author-role="assistant"], [data-content-search-unit-key$=":assistant"]';
const MESSAGE = `${USER}, ${ASSISTANT}`;
const ARTICLE = '[data-testid^="conversation-turn"], [data-turn-key], [data-turn-id-container]';
const MAIN = 'main[data-app-shell-main-surface], main, [role="main"]';
const COMPOSER = 'form[data-chatgpt-composer], form[data-thread-find-composer="true"], form[data-type="unified-composer"], [data-testid="composer"]';
const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Merge observed windows using stable overlapping message IDs. Unknown history is
// never invented. A route change clears this memory rather than persisting chat text.
export function mergeKnownOrder(previous, visible) {
  if (!previous.length) return [...visible];
  if (!visible.length) return [...previous];
  if (!visible.some(id => previous.includes(id))) return [...visible];
  const result = [...previous];
  visible.forEach((id, index) => {
    if (result.includes(id)) return;
    const nextKnown = visible.slice(index + 1).find(next => result.includes(next));
    if (nextKnown) result.splice(result.indexOf(nextKnown), 0, id);
    else {
      const prevKnown = visible.slice(0, index).reverse().find(prev => result.includes(prev));
      result.splice(prevKnown ? result.indexOf(prevKnown) + 1 : result.length, 0, id);
    }
  });
  return result;
}

export function createChatGPTAdapter() {
  const cache = new Map();
  let order = [];
  let serial = 0;
  let weakIds = new WeakMap();
  let generation = 0;
  let disposed = false;
  let observed = [];
  let liveCount = 0;
  const visible = el => el instanceof HTMLElement && el.isConnected && el.getClientRects().length > 0;
  const main = () => {
    const candidates = [...document.querySelectorAll(MAIN)].filter(visible);
    return candidates.find(el => [...el.querySelectorAll(MESSAGE)].some(visible)) || candidates[0] || null;
  };
  const role = el => el.matches(USER) ? 'user' : el.matches(ASSISTANT) ? 'assistant' : null;

  function nodes() {
    const root = main();
    if (!root) return [];
    // Query all message units, including when the turn node itself carries the
    // role. Some ChatGPT releases no longer render an author-role attribute.
    return [...root.querySelectorAll(MESSAGE)].filter(el => !el.parentElement?.closest(MESSAGE) && visible(el));
  }
  function identity(el) {
    const article = el.closest(ARTICLE);
    const stable = el.getAttribute('data-message-id') || el.getAttribute('data-content-search-unit-key') || article?.getAttribute('data-turn-key') || article?.getAttribute('data-turn-id') || article?.getAttribute('data-testid');
    if (stable) return `user:${stable}`;
    if (!weakIds.has(el)) weakIds.set(el, `local:${++serial}`);
    return weakIds.get(el);
  }
  function promptText(el) {
    const value = normalize(el.innerText);
    if (value) return value.slice(0, 100);
    const attachment = [...el.querySelectorAll('img[alt], [aria-label]')].map(node => node.getAttribute('alt') || node.getAttribute('aria-label')).filter(Boolean).join(' ');
    return normalize(attachment).slice(0, 100) || (el.querySelector('img, a[download], [data-testid*="attachment"]') ? '（附件消息）' : '');
  }
  function isGenerating() {
    const root = main();
    const composerRoot = composer();
    const candidates = [...new Set([...(root?.querySelectorAll('button[data-testid="stop-button"], button[data-testid="stop-generating-button"], button[aria-label]') || []), ...(composerRoot?.querySelectorAll('button[aria-label]') || [])])];
    return candidates.some(button => visible(button) && (button.matches('[data-testid="stop-button"], [data-testid="stop-generating-button"]') || /^(stop(?: generating| streaming| responding| response)?|停止(?:生成|响应|回答|输出)?)$/i.test(normalize(button.getAttribute('aria-label')))));
  }
  function listTurns() {
    const messages = nodes();
    const groups = [];
    let current = null;
    for (const el of messages) {
      if (role(el) === 'user') {
        current = { id: identity(el), prompt: promptText(el), response: '', el, streaming: false };
        groups.push(current);
      } else if (current) current.response = normalize(`${current.response} ${el.innerText}`).slice(0, 300);
    }
    const busy = isGenerating();
    liveCount = groups.length;
    if (groups.length) groups.at(-1).streaming = busy;
    for (const value of cache.values()) { if (!value.el?.isConnected || !visible(value.el)) value.el = null; value.streaming = false; }
    const ids = groups.map(item => item.id);
    const merged = mergeKnownOrder(order, ids);
    if (order.length && ids.length && !ids.some(id => order.includes(id))) cache.clear();
    order = merged;
    groups.forEach(item => cache.set(item.id, item));
    const turns = order.map((id, index) => ({ ...cache.get(id), id, turn: index + 1 }));
    observed = turns;
    return turns;
  }
  function findScroller() {
    const messages = nodes();
    const message = messages[0];
    const last = messages.at(-1);
    const containsConversation = el => (!message || el.contains(message)) && (!last || el.contains(last));
    const scrollable = el => {
      const overflow = getComputedStyle(el).overflowY;
      return visible(el) && containsConversation(el) && /(auto|scroll|overlay)/.test(overflow) && el.scrollHeight > el.clientHeight + 80;
    };
    for (let el = message?.parentElement; el; el = el.parentElement) if (scrollable(el)) return el;
    const root = main();
    if (root) {
      if (scrollable(root)) return root;
      const known = [...root.querySelectorAll('[data-app-action-timeline-scroll], [data-conversation-scroll], [role="main"]')].find(scrollable);
      if (known) return known;
      const child = [...root.querySelectorAll('div, section')].find(scrollable);
      if (child) return child;
      for (let el = root.parentElement; el; el = el.parentElement) if (scrollable(el)) return el;
    }
    const known = [...document.querySelectorAll('[data-app-action-timeline-scroll], [data-conversation-scroll]')].find(el => visible(el) && containsConversation(el));
    return known || document.scrollingElement || root;
  }
  function viewport() {
    const scroller = findScroller();
    if (!scroller) return { left: 0, top: 0, width: 0, height: 0, bottom: 0 };
    const docScroller = scroller === document.scrollingElement;
    const rect = docScroller ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : scroller.getBoundingClientRect();
    const left = Math.max(0, rect.left + (docScroller ? 0 : scroller.clientLeft));
    const top = Math.max(0, rect.top + (docScroller ? 0 : scroller.clientTop));
    const right = Math.min(document.documentElement.clientWidth, rect.right, docScroller ? Infinity : rect.left + scroller.clientLeft + scroller.clientWidth);
    const bottom = Math.min(innerHeight, rect.bottom);
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top), bottom };
  }
  function composer() {
    const root = main();
    const forms = [...document.querySelectorAll(COMPOSER)].filter(visible);
    const form = forms.find(el => root?.contains(el)) || forms[0];
    if (form) return form;
    const inputs = [...document.querySelectorAll('#prompt-textarea, [data-testid="composer-input"], [data-composer-markdown][contenteditable="true"], .ProseMirror[contenteditable="true"], [contenteditable="true"][data-lexical-editor="true"]')].filter(visible);
    const input = inputs.find(el => root?.contains(el)) || inputs[0];
    return input?.closest('form, [data-type="unified-composer"], [data-testid="composer"]') || input?.parentElement || null;
  }
  function getHeaderOffset() {
    const view = viewport();
    const root = main();
    const headers = [...new Set([...(root?.querySelectorAll('header, [data-testid*="header"]') || []), ...document.querySelectorAll('header')])];
    let obstruction = 0;
    for (const header of headers) {
      if (!visible(header)) continue;
      const position = getComputedStyle(header).position;
      const rect = header.getBoundingClientRect();
      if ((position === 'sticky' || position === 'fixed') && rect.top <= view.top + 4 && rect.bottom > view.top && rect.left < view.left + view.width && rect.right > view.left) obstruction = Math.max(obstruction, rect.bottom - view.top);
    }
    return Math.min(obstruction, view.height / 2);
  }
  function getComposerHeight() {
    const el = composer();
    return visible(el) ? el.getBoundingClientRect().height : 0;
  }
  function getLayout() {
    const view = viewport();
    const header = getHeaderOffset();
    let bottom = view.bottom;
    const el = composer();
    if (visible(el)) {
      const rect = el.getBoundingClientRect();
      if (rect.top > view.top + header && rect.top < bottom && rect.right > view.left && rect.left < view.left + view.width) bottom = rect.top;
    }
    return { ...view, top: view.top + header, band: Math.max(0, bottom - view.top - header) };
  }
  async function scrollToTurn(item) {
    const token = generation;
    const itemId = item.id;
    const jump = target => {
      const scroller = findScroller();
      if (!scroller || !target.el?.isConnected) return false;
      const view = viewport();
      const top = targetScrollTop(scroller.scrollTop, target.el.getBoundingClientRect().top, view.top, getHeaderOffset(), scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTo({ top, behavior: 'instant' });
      return true;
    };
    if (jump(cache.get(itemId) || item)) return true;
    const scroller = findScroller();
    if (!scroller) return false;
    // Only navigate towards history already observed in this conversation.
    // A bounded wait allows the host to load/render; no requests are made here.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (disposed || token !== generation) return false;
      scroller.scrollTo({ top: 0, behavior: 'instant' });
      for (let poll = 0; poll < 5; poll++) {
        await pause(200);
        if (disposed || token !== generation) return false;
        listTurns();
        if (jump(cache.get(itemId) || {})) return true;
      }
    }
    return false;
  }
  function onChange(callback) {
    let delay = 0;
    let maxWait = 0;
    let stopped = false;
    const notify = () => {
      clearTimeout(delay); clearTimeout(maxWait); delay = maxWait = 0;
      if (!stopped) { try { refreshResizeTargets(); } catch { /* callback reports diagnostic status */ } callback(); }
    };
    const schedule = () => {
      if (stopped) return;
      clearTimeout(delay);
      delay = setTimeout(notify, 150);
      if (!maxWait) maxWait = setTimeout(notify, 300);
    };
    const observer = new MutationObserver(records => {
      if (records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        return !target?.closest('#chatgpt-turn-navigator, #turn-navigator-diagnostics');
      })) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-message-id', 'data-message-author-role', 'data-content-search-unit-key', 'data-turn-key', 'data-testid', 'aria-label', 'hidden', 'aria-hidden', 'inert', 'class', 'style'] });
    const sizes = new ResizeObserver(schedule);
    let resizeTargets = [];
    function refreshResizeTargets() {
      const next = [...new Set([main(), findScroller(), composer()].filter(Boolean))];
      if (next.length === resizeTargets.length && next.every((el, i) => el === resizeTargets[i])) return;
      sizes.disconnect(); next.forEach(el => sizes.observe(el)); resizeTargets = next;
    }
    try { refreshResizeTargets(); } catch { /* retry after host has mounted */ }
    window.addEventListener('resize', schedule);
    window.addEventListener('popstate', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    // Poll URL only: userscript isolated worlds do not reliably patch the page's
    // history functions. This also avoids replacing host-owned functions.
    let url = location.href;
    let lastRefresh = performance.now();
    const routeTimer = setInterval(() => {
      const now = performance.now();
      if (location.href !== url || (!document.hidden && now - lastRefresh >= 1500)) { url = location.href; lastRefresh = now; schedule(); }
    }, 300);
    return () => {
      stopped = true; clearTimeout(delay); clearTimeout(maxWait); clearInterval(routeTimer);
      observer.disconnect(); sizes.disconnect();
      window.removeEventListener('resize', schedule); window.removeEventListener('popstate', schedule);
      window.visualViewport?.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }
  function reset() { generation++; cache.clear(); order = []; observed = []; liveCount = 0; weakIds = new WeakMap(); serial = 0; }
  return {
    findScroller, listTurns, scrollToTurn, getHeaderOffset, getComposerHeight, getLayout, onChange,
    isHealthy: turns => liveCount > 0 && turns.length >= 2 && turns.some(turn => normalize(turn.prompt) || normalize(turn.response)) && observed.some(turn => turn.el?.isConnected),
    reset,
    getDiagnostics() {
      const root = main();
      const scroll = findScroller();
      const layout = getLayout();
      return {
        version: '0.1.1',
        viewport: { width: innerWidth, height: innerHeight },
        main: root ? { tag: root.tagName.toLowerCase(), width: root.clientWidth, height: root.clientHeight } : null,
        legacyUsers: document.querySelectorAll('[data-message-author-role="user"]').length,
        modernUsers: document.querySelectorAll('[data-content-search-unit-key$=":user"]').length,
        recognizedUsers: liveCount,
        knownTurns: order.length,
        scroller: scroll ? { tag: scroll.tagName.toLowerCase(), timeline: scroll.hasAttribute('data-app-action-timeline-scroll'), width: scroll.clientWidth, height: scroll.clientHeight } : null,
        layout: { width: Math.round(layout.width), band: Math.round(layout.band), top: Math.round(layout.top) }
      };
    },
    destroy() { disposed = true; reset(); }
  };
}
