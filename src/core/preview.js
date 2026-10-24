import { clamp, markPosition } from './geometry.js';

export function createPreview(frame) {
  const box = document.createElement('div');
  box.className = 'preview';
  box.id = 'turn-navigator-preview';
  box.setAttribute('role', 'tooltip');
  box.hidden = true;
  const prompt = document.createElement('div');
  prompt.className = 'previewPrompt';
  const response = document.createElement('div');
  response.className = 'previewResponse';
  box.append(prompt, response);
  frame.append(box);
  return {
    id: box.id,
    show(item, index, scrollTop, layout, railHeight) {
      prompt.textContent = item.prompt || `第 ${item.turn} 轮`;
      response.textContent = item.response || (item.streaming ? '正在生成…' : item.el ? '暂无可读取的回答' : '此轮未显示在页面中；点击尝试加载历史');
      box.hidden = false;
      // Keep the tooltip in the reading band, including when the rail is only 22px high.
      const frameTop = (layout.band - railHeight) / 2;
      const boxHeight = box.getBoundingClientRect().height;
      const center = markPosition(index) - scrollTop;
      box.style.top = `${clamp(center - boxHeight / 2, -frameTop, layout.band - frameTop - boxHeight)}px`;
    },
    hide() { box.hidden = true; },
    destroy() { box.remove(); }
  };
}
