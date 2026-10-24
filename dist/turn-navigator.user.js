// ==UserScript==
// @name         ChatGPT 轮次导航 / Turn Navigator
// @namespace    local.chatgpt.turn-navigator
// @version      0.1.1
// @homepageURL  https://github.com/white-thirteen/chatgpt-turn-navigator
// @description  本地只读对话导航：悬停预览、轮次跳转、阅读位置高亮。
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==
// Geometry, state model and interaction semantics ported from DeepSeek Harness
// packages/client/ui-chat/src/client/chat/TurnNavigator.js
// (c) DeepSeek, MIT License — https://github.com/deepseek-ai/deepseek-harness
// Reimplemented from the supplied specification; upstream source parity is unverified.
(() => {
  // src/core/geometry.js
  var TURN_SPACING_PX = 10;
  var RAIL_INSET_PX = 6;
  var clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  var naturalHeight = (count) => count > 0 ? (count - 1) * TURN_SPACING_PX + 2 * RAIL_INSET_PX : 0;
  var visibleHeight = (count, band) => Math.min(naturalHeight(count), Math.max(0, band - 64), 420);
  var markPosition = (index) => index * TURN_SPACING_PX + RAIL_INSET_PX;
  function itemAtPointer(items, frame, scrollTop, clientY) {
    if (!items.length) return void 0;
    const offset = clientY - frame.getBoundingClientRect().top + scrollTop - RAIL_INSET_PX;
    return items[clamp(Math.round(offset / TURN_SPACING_PX), 0, items.length - 1)];
  }
  function railScrollState(scroller) {
    const top = scroller.scrollTop;
    return {
      top,
      canScrollUp: top > 1,
      canScrollDown: top < scroller.scrollHeight - scroller.clientHeight - 1
    };
  }
  function scrollToReveal(index, top, height, contentHeight) {
    const center = markPosition(index);
    let next = top;
    if (center - 5 < top) next = center - 5;
    else if (center + 5 > top + height) next = center + 5 - height;
    return clamp(next, 0, Math.max(0, contentHeight - height));
  }
  function targetScrollTop(currentTop, itemTop, viewportTop, headerOffset, maxTop) {
    return clamp(currentTop + itemTop - viewportTop - headerOffset - 8, 0, Math.max(0, maxTop));
  }
  function activeIndex(tops, threshold) {
    let found = -1;
    for (let i = 0; i < tops.length; i++) {
      if (tops[i] !== null && Number.isFinite(tops[i]) && tops[i] <= threshold) found = i;
    }
    return found >= 0 ? found : Math.max(0, tops.findIndex(Number.isFinite));
  }

  // src/adapters/chatgpt.js
  var USER = '[data-message-author-role="user"], [data-content-search-unit-key$=":user"]';
  var ASSISTANT = '[data-message-author-role="assistant"], [data-content-search-unit-key$=":assistant"]';
  var MESSAGE = `${USER}, ${ASSISTANT}`;
  var ARTICLE = '[data-testid^="conversation-turn"], [data-turn-key], [data-turn-id-container]';
  var MAIN = 'main[data-app-shell-main-surface], main, [role="main"]';
  var COMPOSER = 'form[data-chatgpt-composer], form[data-thread-find-composer="true"], form[data-type="unified-composer"], [data-testid="composer"]';
  var normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  var pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function mergeKnownOrder(previous, visible) {
    if (!previous.length) return [...visible];
    if (!visible.length) return [...previous];
    if (!visible.some((id) => previous.includes(id))) return [...visible];
    const result = [...previous];
    visible.forEach((id, index) => {
      if (result.includes(id)) return;
      const nextKnown = visible.slice(index + 1).find((next) => result.includes(next));
      if (nextKnown) result.splice(result.indexOf(nextKnown), 0, id);
      else {
        const prevKnown = visible.slice(0, index).reverse().find((prev) => result.includes(prev));
        result.splice(prevKnown ? result.indexOf(prevKnown) + 1 : result.length, 0, id);
      }
    });
    return result;
  }
  function createChatGPTAdapter() {
    const cache = /* @__PURE__ */ new Map();
    let order = [];
    let serial = 0;
    let weakIds = /* @__PURE__ */ new WeakMap();
    let generation = 0;
    let disposed = false;
    let observed = [];
    let liveCount = 0;
    const visible = (el) => el instanceof HTMLElement && el.isConnected && el.getClientRects().length > 0;
    const main = () => {
      const candidates = [...document.querySelectorAll(MAIN)].filter(visible);
      return candidates.find((el) => [...el.querySelectorAll(MESSAGE)].some(visible)) || candidates[0] || null;
    };
    const role = (el) => el.matches(USER) ? "user" : el.matches(ASSISTANT) ? "assistant" : null;
    function nodes() {
      const root = main();
      if (!root) return [];
      return [...root.querySelectorAll(MESSAGE)].filter((el) => !el.parentElement?.closest(MESSAGE) && visible(el));
    }
    function identity(el) {
      const article = el.closest(ARTICLE);
      const stable = el.getAttribute("data-message-id") || el.getAttribute("data-content-search-unit-key") || article?.getAttribute("data-turn-key") || article?.getAttribute("data-turn-id") || article?.getAttribute("data-testid");
      if (stable) return `user:${stable}`;
      if (!weakIds.has(el)) weakIds.set(el, `local:${++serial}`);
      return weakIds.get(el);
    }
    function promptText(el) {
      const value = normalize(el.innerText);
      if (value) return value.slice(0, 100);
      const attachment = [...el.querySelectorAll("img[alt], [aria-label]")].map((node) => node.getAttribute("alt") || node.getAttribute("aria-label")).filter(Boolean).join(" ");
      return normalize(attachment).slice(0, 100) || (el.querySelector('img, a[download], [data-testid*="attachment"]') ? "（附件消息）" : "");
    }
    function isGenerating() {
      const root = main();
      const composerRoot = composer();
      const candidates = [.../* @__PURE__ */ new Set([...root?.querySelectorAll('button[data-testid="stop-button"], button[data-testid="stop-generating-button"], button[aria-label]') || [], ...composerRoot?.querySelectorAll("button[aria-label]") || []])];
      return candidates.some((button) => visible(button) && (button.matches('[data-testid="stop-button"], [data-testid="stop-generating-button"]') || /^(stop(?: generating| streaming| responding| response)?|停止(?:生成|响应|回答|输出)?)$/i.test(normalize(button.getAttribute("aria-label")))));
    }
    function listTurns() {
      const messages = nodes();
      const groups = [];
      let current = null;
      for (const el of messages) {
        if (role(el) === "user") {
          current = { id: identity(el), prompt: promptText(el), response: "", el, streaming: false };
          groups.push(current);
        } else if (current) current.response = normalize(`${current.response} ${el.innerText}`).slice(0, 300);
      }
      const busy = isGenerating();
      liveCount = groups.length;
      if (groups.length) groups.at(-1).streaming = busy;
      for (const value of cache.values()) {
        if (!value.el?.isConnected || !visible(value.el)) value.el = null;
        value.streaming = false;
      }
      const ids = groups.map((item) => item.id);
      const merged = mergeKnownOrder(order, ids);
      if (order.length && ids.length && !ids.some((id) => order.includes(id))) cache.clear();
      order = merged;
      groups.forEach((item) => cache.set(item.id, item));
      const turns = order.map((id, index) => ({ ...cache.get(id), id, turn: index + 1 }));
      observed = turns;
      return turns;
    }
    function findScroller() {
      const messages = nodes();
      const message = messages[0];
      const last = messages.at(-1);
      const containsConversation = (el) => (!message || el.contains(message)) && (!last || el.contains(last));
      const scrollable = (el) => {
        const overflow = getComputedStyle(el).overflowY;
        return visible(el) && containsConversation(el) && /(auto|scroll|overlay)/.test(overflow) && el.scrollHeight > el.clientHeight + 80;
      };
      for (let el = message?.parentElement; el; el = el.parentElement) if (scrollable(el)) return el;
      const root = main();
      if (root) {
        if (scrollable(root)) return root;
        const known2 = [...root.querySelectorAll('[data-app-action-timeline-scroll], [data-conversation-scroll], [role="main"]')].find(scrollable);
        if (known2) return known2;
        const child = [...root.querySelectorAll("div, section")].find(scrollable);
        if (child) return child;
        for (let el = root.parentElement; el; el = el.parentElement) if (scrollable(el)) return el;
      }
      const known = [...document.querySelectorAll("[data-app-action-timeline-scroll], [data-conversation-scroll]")].find((el) => visible(el) && containsConversation(el));
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
      const form = forms.find((el) => root?.contains(el)) || forms[0];
      if (form) return form;
      const inputs = [...document.querySelectorAll('#prompt-textarea, [data-testid="composer-input"], [data-composer-markdown][contenteditable="true"], .ProseMirror[contenteditable="true"], [contenteditable="true"][data-lexical-editor="true"]')].filter(visible);
      const input = inputs.find((el) => root?.contains(el)) || inputs[0];
      return input?.closest('form, [data-type="unified-composer"], [data-testid="composer"]') || input?.parentElement || null;
    }
    function getHeaderOffset() {
      const view = viewport();
      const root = main();
      const headers = [.../* @__PURE__ */ new Set([...root?.querySelectorAll('header, [data-testid*="header"]') || [], ...document.querySelectorAll("header")])];
      let obstruction = 0;
      for (const header of headers) {
        if (!visible(header)) continue;
        const position = getComputedStyle(header).position;
        const rect = header.getBoundingClientRect();
        if ((position === "sticky" || position === "fixed") && rect.top <= view.top + 4 && rect.bottom > view.top && rect.left < view.left + view.width && rect.right > view.left) obstruction = Math.max(obstruction, rect.bottom - view.top);
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
      const jump = (target) => {
        const scroller2 = findScroller();
        if (!scroller2 || !target.el?.isConnected) return false;
        const view = viewport();
        const top = targetScrollTop(scroller2.scrollTop, target.el.getBoundingClientRect().top, view.top, getHeaderOffset(), scroller2.scrollHeight - scroller2.clientHeight);
        scroller2.scrollTo({ top, behavior: "instant" });
        return true;
      };
      if (jump(cache.get(itemId) || item)) return true;
      const scroller = findScroller();
      if (!scroller) return false;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (disposed || token !== generation) return false;
        scroller.scrollTo({ top: 0, behavior: "instant" });
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
        clearTimeout(delay);
        clearTimeout(maxWait);
        delay = maxWait = 0;
        if (!stopped) {
          try {
            refreshResizeTargets();
          } catch {
          }
          callback();
        }
      };
      const schedule = () => {
        if (stopped) return;
        clearTimeout(delay);
        delay = setTimeout(notify, 150);
        if (!maxWait) maxWait = setTimeout(notify, 300);
      };
      const observer = new MutationObserver((records) => {
        if (records.some((record) => {
          const target = record.target instanceof Element ? record.target : record.target.parentElement;
          return !target?.closest("#chatgpt-turn-navigator, #turn-navigator-diagnostics");
        })) schedule();
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-message-id", "data-message-author-role", "data-content-search-unit-key", "data-turn-key", "data-testid", "aria-label", "hidden", "aria-hidden", "inert", "class", "style"] });
      const sizes = new ResizeObserver(schedule);
      let resizeTargets = [];
      function refreshResizeTargets() {
        const next = [...new Set([main(), findScroller(), composer()].filter(Boolean))];
        if (next.length === resizeTargets.length && next.every((el, i) => el === resizeTargets[i])) return;
        sizes.disconnect();
        next.forEach((el) => sizes.observe(el));
        resizeTargets = next;
      }
      try {
        refreshResizeTargets();
      } catch {
      }
      window.addEventListener("resize", schedule);
      window.addEventListener("popstate", schedule);
      window.visualViewport?.addEventListener("resize", schedule);
      window.visualViewport?.addEventListener("scroll", schedule);
      let url = location.href;
      let lastRefresh = performance.now();
      const routeTimer = setInterval(() => {
        const now = performance.now();
        if (location.href !== url || !document.hidden && now - lastRefresh >= 1500) {
          url = location.href;
          lastRefresh = now;
          schedule();
        }
      }, 300);
      return () => {
        stopped = true;
        clearTimeout(delay);
        clearTimeout(maxWait);
        clearInterval(routeTimer);
        observer.disconnect();
        sizes.disconnect();
        window.removeEventListener("resize", schedule);
        window.removeEventListener("popstate", schedule);
        window.visualViewport?.removeEventListener("resize", schedule);
        window.visualViewport?.removeEventListener("scroll", schedule);
      };
    }
    function reset() {
      generation++;
      cache.clear();
      order = [];
      observed = [];
      liveCount = 0;
      weakIds = /* @__PURE__ */ new WeakMap();
      serial = 0;
    }
    return {
      findScroller,
      listTurns,
      scrollToTurn,
      getHeaderOffset,
      getComposerHeight,
      getLayout,
      onChange,
      isHealthy: (turns) => liveCount > 0 && turns.length >= 2 && turns.some((turn) => normalize(turn.prompt) || normalize(turn.response)) && observed.some((turn) => turn.el?.isConnected),
      reset,
      getDiagnostics() {
        const root = main();
        const scroll = findScroller();
        const layout = getLayout();
        return {
          version: "0.1.1",
          viewport: { width: innerWidth, height: innerHeight },
          main: root ? { tag: root.tagName.toLowerCase(), width: root.clientWidth, height: root.clientHeight } : null,
          legacyUsers: document.querySelectorAll('[data-message-author-role="user"]').length,
          modernUsers: document.querySelectorAll('[data-content-search-unit-key$=":user"]').length,
          recognizedUsers: liveCount,
          knownTurns: order.length,
          scroller: scroll ? { tag: scroll.tagName.toLowerCase(), timeline: scroll.hasAttribute("data-app-action-timeline-scroll"), width: scroll.clientWidth, height: scroll.clientHeight } : null,
          layout: { width: Math.round(layout.width), band: Math.round(layout.band), top: Math.round(layout.top) }
        };
      },
      destroy() {
        disposed = true;
        reset();
      }
    };
  }

  // src/rail.css
  var rail_default = ':host {\n  all: initial;\n  display: block;\n  position: sticky;\n  top: 0;\n  height: 0;\n  z-index: 7;\n  pointer-events: none;\n  --border-l4: #d4d4d8;\n  --label-tertiary: #71717a;\n  --label-primary: #18181b;\n  --bg-layer-1: #ffffff;\n  --business-primary: #2563eb;\n  --elevation-panel: 0 6px 24px rgba(0,0,0,.12);\n  color-scheme: light;\n}\n:host([hidden]) { display: none !important; }\n:host([data-theme="dark"]) {\n  --border-l4: #3f3f46;\n  --label-tertiary: #a1a1aa;\n  --label-primary: #fafafa;\n  --bg-layer-1: #27272a;\n  --business-primary: #60a5fa;\n  --elevation-panel: 0 6px 24px rgba(0,0,0,.5);\n  color-scheme: dark;\n}\n*, *::before, *::after { box-sizing: border-box; }\n[hidden] { display: none !important; }\n.overlay { position: fixed; height: 0; pointer-events: none; font-family: system-ui, sans-serif; direction: ltr; }\n.frame { position: absolute; width: 28px; right: 16px; top: calc(var(--band) / 2); transform: translateY(-50%); pointer-events: auto; cursor: pointer; transition: height .22s cubic-bezier(.2,.8,.2,1); }\n.scroller { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-width: none; }\n.scroller::-webkit-scrollbar { display: none; }\n.scroller[data-fade="up"] { mask-image: linear-gradient(to bottom, transparent, #000 24px); }\n.scroller[data-fade="down"] { mask-image: linear-gradient(to bottom, #000 calc(100% - 24px), transparent); }\n.scroller[data-fade="both"] { mask-image: linear-gradient(to bottom, transparent, #000 24px, #000 calc(100% - 24px), transparent); }\n.content { position: relative; width: 28px; }\n.mark { position: absolute; left: 0; right: 0; width: 28px; height: 10px; transform: translateY(-50%); padding: 0; margin: 0; border: 0; background: none; cursor: pointer; color: inherit; appearance: none; outline: none; }\n.markNew { animation: enter .15s ease-out; }\n.mark::before { content: ""; position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 12px; height: 2px; border-radius: 2px; background: var(--border-l4); transition: width .14s, background-color .14s; }\n.markPreview::before { width: 18px; background: var(--label-tertiary); }\n.markActive::before, .markBusy::before { width: 20px; background: var(--label-primary); }\n.markUnloaded::before { width: 8px; opacity: .6; }\n.markBusy::before { animation: busy 1s ease-in-out infinite; }\n.mark:focus-visible::before { width: 20px; background: var(--business-primary); outline: 1px solid var(--business-primary); outline-offset: 2px; }\n.preview { position: absolute; right: calc(100% + 10px); width: min(300px, max(80px, calc(var(--container-width) - 120px))); max-height: 100px; padding: 10px 12px; border-radius: 10px; overflow: hidden; background: var(--bg-layer-1); color: var(--label-primary); box-shadow: var(--elevation-panel); pointer-events: none; transition: top .14s ease; animation: appear .12s ease-out; text-align: start; overflow-wrap: anywhere; }\n.previewPrompt, .previewResponse { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; white-space: normal; }\n.previewPrompt { font-size: 13px; line-height: 18px; font-weight: 700; -webkit-line-clamp: 1; }\n.previewResponse { font-size: 12px; line-height: 16px; color: var(--label-tertiary); margin-top: 4px; -webkit-line-clamp: 3; }\n@keyframes busy { 0%,100% { opacity: 1; } 50% { opacity: .35; } }\n@keyframes enter { from { opacity: 0; } to { opacity: 1; } }\n@keyframes appear { from { opacity: 0; transform: translateX(4px); } to { opacity: 1; transform: translateX(0); } }\n@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }\n}\n';

  // src/core/preview.js
  function createPreview(frame) {
    const box = document.createElement("div");
    box.className = "preview";
    box.id = "turn-navigator-preview";
    box.setAttribute("role", "tooltip");
    box.hidden = true;
    const prompt = document.createElement("div");
    prompt.className = "previewPrompt";
    const response = document.createElement("div");
    response.className = "previewResponse";
    box.append(prompt, response);
    frame.append(box);
    return {
      id: box.id,
      show(item, index, scrollTop, layout, railHeight) {
        prompt.textContent = item.prompt || `第 ${item.turn} 轮`;
        response.textContent = item.response || (item.streaming ? "正在生成…" : item.el ? "暂无可读取的回答" : "此轮未显示在页面中；点击尝试加载历史");
        box.hidden = false;
        const frameTop = (layout.band - railHeight) / 2;
        const boxHeight = box.getBoundingClientRect().height;
        const center = markPosition(index) - scrollTop;
        box.style.top = `${clamp(center - boxHeight / 2, -frameTop, layout.band - frameTop - boxHeight)}px`;
      },
      hide() {
        box.hidden = true;
      },
      destroy() {
        box.remove();
      }
    };
  }

  // src/core/theme.js
  function watchTheme(host) {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const html = document.documentElement;
      const explicit = html.getAttribute("data-theme") || html.getAttribute("data-color-mode");
      let dark;
      if (html.classList.contains("dark") || explicit === "dark") dark = true;
      else if (html.classList.contains("light") || explicit === "light") dark = false;
      else {
        const scheme = html.style.colorScheme;
        dark = scheme === "dark" ? true : scheme === "light" ? false : media.matches;
      }
      host.dataset.theme = dark ? "dark" : "light";
    };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-color-mode"] });
    media.addEventListener("change", update);
    update();
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }

  // src/core/rail.js
  function mountRail({ items = [], activeId = null, onNavigate, container = document.body }) {
    const host = document.createElement("div");
    host.id = "chatgpt-turn-navigator";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = rail_default;
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const frame = document.createElement("nav");
    frame.className = "frame";
    frame.setAttribute("aria-label", "对话轮次导航（已识别的历史）");
    const scroller = document.createElement("div");
    scroller.className = "scroller";
    const content = document.createElement("div");
    content.className = "content";
    scroller.append(content);
    frame.append(scroller);
    overlay.append(frame);
    shadow.append(style, overlay);
    container.append(host);
    const stopTheme = watchTheme(host);
    const preview = createPreview(frame);
    const buttons = /* @__PURE__ */ new Map();
    let layout = { left: 0, top: 0, width: 0, height: 0, band: 0 };
    let pointerInside = false;
    let focusedId = null;
    let pointerId = null;
    let height = 0;
    let destroyed = false;
    let pendingFrame = 0;
    const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    function updateFade() {
      const state = railScrollState(scroller);
      scroller.dataset.fade = state.canScrollUp && state.canScrollDown ? "both" : state.canScrollUp ? "up" : state.canScrollDown ? "down" : "none";
    }
    function paint() {
      const previewId = focusedId || pointerId;
      let selected;
      items.forEach((item, index) => {
        const button = buttons.get(item.id);
        if (!button) return;
        const active = item.id === activeId;
        button.classList.toggle("markActive", active);
        button.classList.toggle("markPreview", !active && item.id === previewId);
        button.classList.toggle("markUnloaded", !item.el);
        button.classList.toggle("markBusy", !!item.streaming);
        if (active) button.setAttribute("aria-current", "true");
        else button.removeAttribute("aria-current");
        button.setAttribute("aria-busy", String(!!item.streaming));
        button.setAttribute("aria-label", `跳转到第 ${item.turn} 轮${item.el ? "" : "（会加载历史）"}`);
        if (item.id === previewId) {
          button.setAttribute("aria-describedby", preview.id);
          selected = { item, index };
        } else button.removeAttribute("aria-describedby");
      });
      if (selected && !host.hidden) preview.show(selected.item, selected.index, scroller.scrollTop, layout, height);
      else preview.hide();
    }
    function follow() {
      if (pointerInside || focusedId || host.hidden) return;
      const index = items.findIndex((item) => item.id === activeId);
      if (index < 0) return;
      const next = scrollToReveal(index, scroller.scrollTop, height, naturalHeight(items.length));
      if (Math.abs(next - scroller.scrollTop) > 0.5) scroller.scrollTo({ top: next, behavior: prefersReducedMotion.matches ? "instant" : "smooth" });
    }
    function navigate(item) {
      if (item) Promise.resolve(onNavigate(item)).catch(() => {
      });
    }
    scroller.addEventListener("pointerenter", () => {
      pointerInside = true;
      scroller.scrollTo({ top: scroller.scrollTop, behavior: "instant" });
    });
    scroller.addEventListener("pointermove", (event) => {
      pointerId = itemAtPointer(items, frame, scroller.scrollTop, event.clientY)?.id || null;
      paint();
    });
    scroller.addEventListener("pointerleave", () => {
      pointerInside = false;
      pointerId = null;
      paint();
      follow();
    });
    scroller.addEventListener("click", (event) => {
      const item = event.detail === 0 && event.target.closest("button") ? items.find((turn) => turn.id === event.target.closest("button").dataset.turnId) : itemAtPointer(items, frame, scroller.scrollTop, event.clientY);
      navigate(item);
    });
    scroller.addEventListener("focusin", (event) => {
      focusedId = event.target.closest("button")?.dataset.turnId || null;
      paint();
    });
    scroller.addEventListener("focusout", (event) => {
      if (!scroller.contains(event.relatedTarget)) {
        focusedId = null;
        paint();
        follow();
      }
    });
    scroller.addEventListener("keydown", (event) => {
      const index = items.findIndex((item) => item.id === focusedId);
      const next = event.key === "ArrowDown" ? Math.min(items.length - 1, index + 1) : event.key === "ArrowUp" ? Math.max(0, index - 1) : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
      if (next >= 0) {
        event.preventDefault();
        const top = scrollToReveal(next, scroller.scrollTop, height, naturalHeight(items.length));
        scroller.scrollTo({ top, behavior: "instant" });
        buttons.get(items[next].id)?.focus({ preventScroll: true });
      } else if (event.key === "Escape") {
        event.target.blur();
        pointerId = null;
        paint();
      }
    });
    scroller.addEventListener("scroll", () => {
      updateFade();
      paint();
    }, { passive: true });
    scroller.addEventListener("wheel", (event) => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
      scroller.scrollTop += delta;
    }, { passive: false });
    frame.addEventListener("transitionend", () => {
      updateFade();
      follow();
    });
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
        overlay.style.setProperty("--band", `${layout.band}px`);
        overlay.style.setProperty("--container-width", `${layout.width}px`);
        frame.style.height = `${height}px`;
        content.style.height = `${naturalHeight(items.length)}px`;
        const liveIds = new Set(items.map((item) => item.id));
        for (const [id, button] of buttons) {
          if (!liveIds.has(id)) {
            button.remove();
            buttons.delete(id);
          }
        }
        if (!liveIds.has(focusedId)) focusedId = null;
        if (!liveIds.has(pointerId)) pointerId = null;
        items.forEach((item, index) => {
          let button = buttons.get(item.id);
          if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.className = "mark markNew";
            button.dataset.turnId = item.id;
            button.addEventListener("animationend", () => button.classList.remove("markNew"), { once: true });
            buttons.set(item.id, button);
          }
          button.style.top = `${markPosition(index)}px`;
          if (content.children[index] !== button) content.insertBefore(button, content.children[index] || null);
        });
        paint();
        updateFade();
        cancelAnimationFrame(pendingFrame);
        pendingFrame = requestAnimationFrame(() => {
          updateFade();
          follow();
        });
      },
      hide() {
        host.hidden = true;
        preview.hide();
      },
      reset() {
        focusedId = null;
        pointerId = null;
        pointerInside = false;
        scroller.scrollTop = 0;
        for (const button of buttons.values()) button.remove();
        buttons.clear();
        preview.hide();
      },
      destroy() {
        destroyed = true;
        cancelAnimationFrame(pendingFrame);
        stopTheme();
        preview.destroy();
        host.remove();
        buttons.clear();
      }
    };
  }

  // src/core/diagnostics.js
  function mountDiagnostics() {
    const host = document.createElement("div");
    host.id = "turn-navigator-diagnostics";
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
    :host { all: initial; position: fixed; right: 14px; bottom: 100px; z-index: 2147483646; font-family: system-ui,sans-serif; font-size: 12px; color-scheme: light dark; }
    [hidden] { display:none !important; }
    button { font: inherit; padding: 6px 10px; border: 1px solid #8886; border-radius: 8px; background: light-dark(#fff,#27272a); color: light-dark(#18181b,#fafafa); cursor:pointer; }
    section { box-sizing: border-box; width: min(370px,calc(100vw - 32px)); max-height: min(560px,calc(100vh - 32px)); overflow:auto; padding:14px; border-radius:12px; border:1px solid #8886; box-shadow:0 6px 24px #0003; background:light-dark(#fff,#27272a); color:light-dark(#18181b,#fafafa); }
    header { display:flex; align-items:center; justify-content:space-between; gap:10px; font-weight:bold; }
    p { margin:10px 0; line-height:1.5; }
    pre { font:11px/1.4 ui-monospace,monospace; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; }
  `;
    const badge = document.createElement("button");
    badge.type = "button";
    badge.hidden = true;
    const panel = document.createElement("section");
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "轮次导航诊断");
    const header = document.createElement("header");
    header.textContent = "轮次导航 v0.1.1";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "关闭";
    close.addEventListener("click", () => {
      panel.hidden = true;
    });
    header.append(close);
    const description = document.createElement("p");
    const tip = document.createElement("p");
    tip.textContent = "以下仅为页面结构与尺寸，不含聊天内容。可复制下面结果用于排查。Alt+Shift+N 可随时打开。";
    const pre = document.createElement("pre");
    panel.append(header, description, tip, pre);
    root.append(style, badge, panel);
    document.body.append(host);
    badge.addEventListener("click", () => {
      panel.hidden = false;
    });
    const onKey = (event) => {
      if (event.altKey && event.shiftKey && event.code === "KeyN") {
        event.preventDefault();
        panel.hidden = !panel.hidden;
      }
    };
    window.addEventListener("keydown", onKey);
    let ready = false;
    let lastReason = "";
    const grace = setTimeout(() => {
      ready = true;
      badge.hidden = !lastReason;
    }, 3500);
    return {
      update(reason, details) {
        lastReason = reason;
        description.textContent = reason || "导航已识别消息。关闭开发者工具后可检查页面右侧。";
        pre.textContent = JSON.stringify(details, null, 2);
        badge.textContent = reason ? "轮次导航未显示 · 查看原因" : "轮次导航";
        badge.hidden = !ready || !reason;
      },
      destroy() {
        clearTimeout(grace);
        window.removeEventListener("keydown", onKey);
        host.remove();
      }
    };
  }

  // src/index.js
  (() => {
    const INSTANCE = "__chatgptTurnNavigator_v1";
    if (!["chatgpt.com", "chat.openai.com"].includes(location.hostname)) return;
    window[INSTANCE]?.destroy?.();
    const adapter = createChatGPTAdapter();
    const diagnostic = mountDiagnostics();
    let rail;
    let turns = [];
    let activeId = null;
    let scroller = null;
    let frame = 0;
    let pinUntil = 0;
    let route = location.pathname;
    let stopped = false;
    let unhealthy = false;
    let jumpSerial = 0;
    let pinTimer = 0;
    let stopWatching = () => {
    };
    let lastDiagnosticAt = 0;
    let lastDiagnosticReason = null;
    const fallbackLayout = { left: 0, top: 0, width: 0, height: 0, band: 0 };
    function status(reason, force = false) {
      if (!force && reason === lastDiagnosticReason && performance.now() - lastDiagnosticAt < 1e3) return;
      lastDiagnosticAt = performance.now();
      lastDiagnosticReason = reason;
      let details;
      try {
        details = adapter.getDiagnostics();
      } catch {
        details = { version: "0.1.1", status: "adapter exception" };
      }
      diagnostic.update(reason, details);
      if (rail) {
        rail.host.dataset.status = reason ? "hidden" : "ready";
        rail.host.dataset.version = "0.1.1";
      }
    }
    function fail() {
      rail?.hide();
      if (!unhealthy) console.warn("[turn-navigator] adapter unhealthy, rail hidden");
      unhealthy = true;
      status("页面结构暂未识别，导航已安全隐藏。", true);
    }
    function safely(fn, fallback) {
      try {
        return fn();
      } catch {
        fail();
        return fallback;
      }
    }
    function updateActive() {
      if (stopped || !rail || !turns.length) return;
      safely(() => {
        const layout = adapter.getLayout();
        if (performance.now() >= pinUntil) {
          const threshold = layout.top + Math.min(layout.band * 0.33, 240);
          const tops = turns.map((turn) => turn.el?.isConnected ? turn.el.getBoundingClientRect().top : null);
          const atBottom = scroller && scroller.scrollHeight > scroller.clientHeight + 1 && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 2;
          const lastLoaded = turns.findLastIndex((turn) => turn.el?.isConnected);
          activeId = turns[atBottom && lastLoaded >= 0 ? lastLoaded : activeIndex(tops, threshold)]?.id || null;
        }
        rail.update(turns, activeId, layout);
        status(layout.width <= 900 ? "聊天区域宽度不足 900px；请放大窗口或收起侧栏。" : layout.band <= 64 ? "可阅读区域高度不足；请关闭或缩小开发者工具。" : "");
      });
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        updateActive();
      });
    }
    function bindScroller(next) {
      if (next === scroller) return;
      const target = scroller === document.scrollingElement ? window : scroller;
      target?.removeEventListener("scroll", onScroll);
      scroller = next;
      const nextTarget = scroller === document.scrollingElement ? window : scroller;
      nextTarget?.addEventListener("scroll", onScroll, { passive: true });
    }
    async function navigate(item) {
      const serial = ++jumpSerial;
      activeId = item.id;
      pinUntil = Infinity;
      updateActive();
      try {
        await adapter.scrollToTurn(item);
      } catch {
        fail();
      } finally {
        if (!stopped && serial === jumpSerial) {
          pinUntil = performance.now() + 300;
          rebuild();
          clearTimeout(pinTimer);
          pinTimer = setTimeout(updateActive, 310);
        }
      }
    }
    function rebuild() {
      if (stopped) return;
      if (location.pathname !== route) {
        route = location.pathname;
        jumpSerial++;
        pinUntil = 0;
        activeId = null;
        turns = [];
        safely(() => adapter.reset());
        rail?.reset();
        rail?.hide();
      }
      if (rail && !rail.host.isConnected) {
        rail.destroy();
        rail = null;
      }
      if (!rail) rail = mountRail({ onNavigate: navigate });
      const next = safely(() => adapter.listTurns(), null);
      if (!next) return;
      turns = next;
      bindScroller(safely(() => adapter.findScroller(), null));
      if (turns.length < 2) {
        rail.update([], null, fallbackLayout);
        unhealthy = false;
        status(turns.length === 1 ? "" : location.pathname.includes("/c/") ? "没有识别到当前对话消息；页面可能仍在加载，或页面结构已变化。" : "", true);
        return;
      }
      if (!safely(() => adapter.isHealthy(turns), false)) {
        fail();
        return;
      }
      unhealthy = false;
      updateActive();
    }
    const destroy = () => {
      if (stopped) return;
      stopped = true;
      stopWatching();
      bindScroller(null);
      adapter.destroy();
      rail?.destroy();
      diagnostic.destroy();
      cancelAnimationFrame(frame);
      clearTimeout(pinTimer);
      window.removeEventListener("pagehide", onPageHide);
      if (window[INSTANCE]?.destroy === destroy) delete window[INSTANCE];
    };
    function onPageHide(event) {
      if (!event.persisted) destroy();
    }
    window.addEventListener("pagehide", onPageHide);
    window[INSTANCE] = { destroy };
    try {
      stopWatching = adapter.onChange(rebuild);
      rebuild();
    } catch {
      fail();
    }
  })();
})();
