import { createChatGPTAdapter } from './adapters/chatgpt.js';
import { mountRail } from './core/rail.js';
import { activeIndex } from './core/geometry.js';
import { mountDiagnostics } from './core/diagnostics.js';

(() => {
  const INSTANCE = '__chatgptTurnNavigator_v1';
  if (!['chatgpt.com', 'chat.openai.com'].includes(location.hostname)) return;
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
  let stopWatching = () => {};
  let lastDiagnosticAt = 0;
  let lastDiagnosticReason = null;
  const fallbackLayout = { left: 0, top: 0, width: 0, height: 0, band: 0 };

  function status(reason, force = false) {
    if (!force && reason === lastDiagnosticReason && performance.now() - lastDiagnosticAt < 1000) return;
    lastDiagnosticAt = performance.now();
    lastDiagnosticReason = reason;
    let details;
    try { details = adapter.getDiagnostics(); } catch { details = { version: '0.1.1', status: 'adapter exception' }; }
    diagnostic.update(reason, details);
    if (rail) { rail.host.dataset.status = reason ? 'hidden' : 'ready'; rail.host.dataset.version = '0.1.1'; }
  }
  function fail() {
    rail?.hide();
    if (!unhealthy) console.warn('[turn-navigator] adapter unhealthy, rail hidden');
    unhealthy = true;
    status('页面结构暂未识别，导航已安全隐藏。', true);
  }
  function safely(fn, fallback) {
    try { return fn(); } catch { fail(); return fallback; }
  }
  function updateActive() {
    if (stopped || !rail || !turns.length) return;
    safely(() => {
      const layout = adapter.getLayout();
      if (performance.now() >= pinUntil) {
        const threshold = layout.top + Math.min(layout.band * .33, 240);
        const tops = turns.map(turn => turn.el?.isConnected ? turn.el.getBoundingClientRect().top : null);
        const atBottom = scroller && scroller.scrollHeight > scroller.clientHeight + 1 && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 2;
        const lastLoaded = turns.findLastIndex(turn => turn.el?.isConnected);
        activeId = turns[atBottom && lastLoaded >= 0 ? lastLoaded : activeIndex(tops, threshold)]?.id || null;
      }
      rail.update(turns, activeId, layout);
      status(layout.width <= 900 ? '聊天区域宽度不足 900px；请放大窗口或收起侧栏。' : layout.band <= 64 ? '可阅读区域高度不足；请关闭或缩小开发者工具。' : '');
    });
  }
  function onScroll() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; updateActive(); });
  }
  function bindScroller(next) {
    if (next === scroller) return;
    const target = scroller === document.scrollingElement ? window : scroller;
    target?.removeEventListener('scroll', onScroll);
    scroller = next;
    const nextTarget = scroller === document.scrollingElement ? window : scroller;
    nextTarget?.addEventListener('scroll', onScroll, { passive: true });
  }
  async function navigate(item) {
    const serial = ++jumpSerial;
    activeId = item.id;
    pinUntil = Infinity;
    updateActive();
    try { await adapter.scrollToTurn(item); }
    catch { fail(); }
    finally {
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
      route = location.pathname; jumpSerial++; pinUntil = 0; activeId = null; turns = [];
      safely(() => adapter.reset()); rail?.reset(); rail?.hide();
    }
    if (rail && !rail.host.isConnected) { rail.destroy(); rail = null; }
    if (!rail) rail = mountRail({ onNavigate: navigate });
    const next = safely(() => adapter.listTurns(), null);
    if (!next) return;
    turns = next;
    bindScroller(safely(() => adapter.findScroller(), null));
    // Zero/one turn is normal, not an adapter error.
    if (turns.length < 2) {
      rail.update([], null, fallbackLayout); unhealthy = false;
      status(turns.length === 1 ? '' : location.pathname.includes('/c/') ? '没有识别到当前对话消息；页面可能仍在加载，或页面结构已变化。' : '', true);
      return;
    }
    if (!safely(() => adapter.isHealthy(turns), false)) { fail(); return; }
    unhealthy = false;
    updateActive();
  }
  const destroy = () => {
    if (stopped) return;
    stopped = true; stopWatching(); bindScroller(null); adapter.destroy(); rail?.destroy(); diagnostic.destroy();
    cancelAnimationFrame(frame); clearTimeout(pinTimer);
    window.removeEventListener('pagehide', onPageHide);
    if (window[INSTANCE]?.destroy === destroy) delete window[INSTANCE];
  };
  function onPageHide(event) { if (!event.persisted) destroy(); }
  window.addEventListener('pagehide', onPageHide);
  window[INSTANCE] = { destroy };
  try { stopWatching = adapter.onChange(rebuild); rebuild(); } catch { fail(); }
})();
