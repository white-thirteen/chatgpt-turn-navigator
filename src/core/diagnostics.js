// Local structural status only. Never include message text, message IDs or URLs.
export function mountDiagnostics() {
  const host = document.createElement('div');
  host.id = 'turn-navigator-diagnostics';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; position: fixed; right: 14px; bottom: 100px; z-index: 2147483646; font-family: system-ui,sans-serif; font-size: 12px; color-scheme: light dark; }
    [hidden] { display:none !important; }
    button { font: inherit; padding: 6px 10px; border: 1px solid #8886; border-radius: 8px; background: light-dark(#fff,#27272a); color: light-dark(#18181b,#fafafa); cursor:pointer; }
    section { box-sizing: border-box; width: min(370px,calc(100vw - 32px)); max-height: min(560px,calc(100vh - 32px)); overflow:auto; padding:14px; border-radius:12px; border:1px solid #8886; box-shadow:0 6px 24px #0003; background:light-dark(#fff,#27272a); color:light-dark(#18181b,#fafafa); }
    header { display:flex; align-items:center; justify-content:space-between; gap:10px; font-weight:bold; }
    p { margin:10px 0; line-height:1.5; }
    pre { font:11px/1.4 ui-monospace,monospace; white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; }
  `;
  const badge = document.createElement('button');
  badge.type = 'button'; badge.hidden = true;
  const panel = document.createElement('section'); panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '轮次导航诊断');
  const header = document.createElement('header'); header.textContent = '轮次导航 v0.1.1';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭';
  close.addEventListener('click', () => { panel.hidden = true; });
  header.append(close);
  const description = document.createElement('p');
  const tip = document.createElement('p'); tip.textContent = '以下仅为页面结构与尺寸，不含聊天内容。可复制下面结果用于排查。Alt+Shift+N 可随时打开。';
  const pre = document.createElement('pre');
  panel.append(header, description, tip, pre);
  root.append(style, badge, panel); document.body.append(host);
  badge.addEventListener('click', () => { panel.hidden = false; });
  const onKey = event => {
    if (event.altKey && event.shiftKey && event.code === 'KeyN') { event.preventDefault(); panel.hidden = !panel.hidden; }
  };
  window.addEventListener('keydown', onKey);
  let ready = false;
  let lastReason = '';
  const grace = setTimeout(() => { ready = true; badge.hidden = !lastReason; }, 3500);
  return {
    update(reason, details) {
      lastReason = reason;
      description.textContent = reason || '导航已识别消息。关闭开发者工具后可检查页面右侧。';
      pre.textContent = JSON.stringify(details, null, 2);
      badge.textContent = reason ? '轮次导航未显示 · 查看原因' : '轮次导航';
      badge.hidden = !ready || !reason;
    },
    destroy() { clearTimeout(grace); window.removeEventListener('keydown', onKey); host.remove(); }
  };
}
