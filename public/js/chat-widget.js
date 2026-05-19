/**
 * chat-widget.js
 * Pluggable chat widget — embed on any webpage with a single <script> tag.
 *
 * Usage:
 *   <script src="/js/chat-widget.js"
 *           data-api-url="https://your-server.com/api/chat"
 *           data-position="bottom-right"
 *           data-title="AI Chat"
 *           data-theme="light">
 *   </script>
 *
 * Config options (data attributes):
 *   data-api-url   — required. URL of the /api/chat endpoint.
 *   data-position  — "bottom-right" (default) | "bottom-left"
 *   data-title     — widget header title (default: "AI Chat")
 *   data-theme     — "light" (default) | "dark"
 */

(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────
  const script = document.currentScript;
  const API_URL = script?.getAttribute('data-api-url') || '/api/chat';
  const POSITION = script?.getAttribute('data-position') || 'bottom-right';
  const TITLE = script?.getAttribute('data-title') || 'AI Chat';
  const THEME = script?.getAttribute('data-theme') || 'light';
  const MARKDOWN_IT_CDN = 'https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/dist/markdown-it.min.js';
  let markdownRenderer = null;

  // ── Styles ───────────────────────────────────────────────────────────────────
  const COLORS = {
    light: {
      bg: '#ffffff',
      header: '#2563eb',
      headerText: '#ffffff',
      userBubble: '#dbeafe',
      userText: '#1e40af',
      botBubble: '#f0fdf4',
      botText: '#166534',
      input: '#f9fafb',
      border: '#e5e7eb',
      sendBtn: '#2563eb',
      sendBtnHover: '#1d4ed8',
      text: '#111827',
      placeholder: '#9ca3af',
    },
    dark: {
      bg: '#1f2937',
      header: '#1e3a8a',
      headerText: '#f9fafb',
      userBubble: '#1e40af',
      userText: '#dbeafe',
      botBubble: '#14532d',
      botText: '#bbf7d0',
      input: '#374151',
      border: '#4b5563',
      sendBtn: '#2563eb',
      sendBtnHover: '#1d4ed8',
      text: '#f9fafb',
      placeholder: '#9ca3af',
    },
  };

  const c = COLORS[THEME] || COLORS.light;
  const isLeft = POSITION === 'bottom-left';

  const css = `
    #cw-launcher {
      position: fixed;
      bottom: 24px;
      ${isLeft ? 'left: 24px' : 'right: 24px'};
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: ${c.header};
      color: ${c.headerText};
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99998;
      font-size: 22px;
      transition: background 0.2s;
    }
    #cw-launcher:hover { background: ${c.sendBtnHover}; }

    #cw-container {
      position: fixed;
      bottom: 88px;
      ${isLeft ? 'left: 24px' : 'right: 24px'};
      width: 360px;
      height: 520px;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: ${c.bg};
      border: 1px solid ${c.border};
      z-index: 99999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      color: ${c.text};
    }
    #cw-container.cw-hidden { display: none; }

    #cw-header {
      background: ${c.header};
      color: ${c.headerText};
      padding: 12px 16px;
      font-weight: 600;
      font-size: 15px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    #cw-close {
      background: none;
      border: none;
      color: ${c.headerText};
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 0;
      opacity: 0.8;
    }
    #cw-close:hover { opacity: 1; }

    #cw-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .cw-msg {
      max-width: 82%;
      padding: 8px 12px;
      border-radius: 12px;
      line-height: 1.45;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .cw-msg.cw-user {
      align-self: flex-end;
      background: ${c.userBubble};
      color: ${c.userText};
      border-bottom-right-radius: 3px;
    }
    .cw-msg.cw-bot {
      align-self: flex-start;
      background: ${c.botBubble};
      color: ${c.botText};
      border-bottom-left-radius: 3px;
      white-space: normal;
    }
    .cw-msg.cw-bot p {
      margin: 0 0 8px;
    }
    .cw-msg.cw-bot p:last-child { margin-bottom: 0; }
    .cw-msg.cw-bot h1,
    .cw-msg.cw-bot h2,
    .cw-msg.cw-bot h3,
    .cw-msg.cw-bot h4,
    .cw-msg.cw-bot h5,
    .cw-msg.cw-bot h6 {
      margin: 0 0 8px;
      line-height: 1.3;
      color: inherit;
    }
    .cw-msg.cw-bot h1 { font-size: 1.1rem; }
    .cw-msg.cw-bot h2 { font-size: 1.02rem; }
    .cw-msg.cw-bot h3,
    .cw-msg.cw-bot h4,
    .cw-msg.cw-bot h5,
    .cw-msg.cw-bot h6 { font-size: 0.96rem; }
    .cw-msg.cw-bot ul,
    .cw-msg.cw-bot ol {
      margin: 0 0 8px 18px;
      padding: 0;
    }
    .cw-msg.cw-bot li { margin-bottom: 4px; }
    .cw-msg.cw-bot a {
      color: inherit;
      text-decoration: underline;
    }
    .cw-msg.cw-bot code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
      font-size: 0.9em;
      background: rgba(0, 0, 0, 0.1);
      border-radius: 4px;
      padding: 1px 4px;
    }
    .cw-msg.cw-bot pre {
      margin: 0 0 8px;
      padding: 8px;
      border-radius: 8px;
      overflow-x: auto;
      background: rgba(0, 0, 0, 0.14);
    }
    .cw-msg.cw-bot pre code {
      background: transparent;
      padding: 0;
      font-size: 0.84em;
      white-space: pre;
    }
    .cw-msg.cw-bot table {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 8px;
      font-size: 0.92em;
    }
    .cw-msg.cw-bot th,
    .cw-msg.cw-bot td {
      border: 1px solid rgba(0, 0, 0, 0.18);
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    .cw-msg.cw-bot th {
      font-weight: 700;
      background: rgba(0, 0, 0, 0.08);
    }
    .cw-msg.cw-error {
      align-self: flex-start;
      background: #fee2e2;
      color: #991b1b;
    }
    #cw-typing {
      align-self: flex-start;
      padding: 8px 12px;
      background: ${c.botBubble};
      color: ${c.botText};
      border-radius: 12px;
      border-bottom-left-radius: 3px;
      font-style: italic;
      opacity: 0.8;
      display: none;
    }

    #cw-input-area {
      flex-shrink: 0;
      border-top: 1px solid ${c.border};
      padding: 10px;
      display: flex;
      gap: 8px;
      background: ${c.bg};
    }
    #cw-input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid ${c.border};
      border-radius: 8px;
      background: ${c.input};
      color: ${c.text};
      outline: none;
      font-size: 14px;
      font-family: inherit;
    }
    #cw-input::placeholder { color: ${c.placeholder}; }
    #cw-input:focus { border-color: ${c.sendBtn}; }
    #cw-send {
      padding: 8px 14px;
      background: ${c.sendBtn};
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: background 0.15s;
    }
    #cw-send:hover:not(:disabled) { background: ${c.sendBtnHover}; }
    #cw-send:disabled { opacity: 0.5; cursor: not-allowed; }
  `;

  // ── DOM ──────────────────────────────────────────────────────────────────────
  function mount() {
    initializeMarkdownRenderer();

    // Style tag
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    // Launcher button
    const launcher = document.createElement('button');
    launcher.id = 'cw-launcher';
    launcher.title = 'Open chat';
    launcher.innerHTML = '💬';
    launcher.setAttribute('aria-label', 'Open chat');
    document.body.appendChild(launcher);

    // Widget container
    const container = document.createElement('div');
    container.id = 'cw-container';
    container.classList.add('cw-hidden');
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-label', TITLE);
    container.innerHTML = `
      <div id="cw-header">
        <span>${escapeHtml(TITLE)}</span>
        <button id="cw-close" aria-label="Close chat">✕</button>
      </div>
      <div id="cw-messages" aria-live="polite">
        <div class="cw-msg cw-bot">👋 Hi! How can I help you today?</div>
      </div>
      <div id="cw-typing">Thinking…</div>
      <div id="cw-input-area">
        <input id="cw-input" type="text" placeholder="Type a message…" autocomplete="off" maxlength="2000" />
        <button id="cw-send">Send</button>
      </div>
    `;
    document.body.appendChild(container);

    // Move typing indicator inside messages scroll area
    const msgs = container.querySelector('#cw-messages');
    const typing = container.querySelector('#cw-typing');
    msgs.appendChild(typing);

    // ── Events ──
    launcher.addEventListener('click', () => {
      container.classList.remove('cw-hidden');
      launcher.style.display = 'none';
      container.querySelector('#cw-input').focus();
    });

    container.querySelector('#cw-close').addEventListener('click', () => {
      container.classList.add('cw-hidden');
      launcher.style.display = 'flex';
    });

    const input = container.querySelector('#cw-input');
    const sendBtn = container.querySelector('#cw-send');

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    sendBtn.addEventListener('click', sendMessage);

    // ── State ──
    const history = [];

    function sendMessage() {
      const text = input.value.trim();
      if (!text) return;

      appendMessage('user', text);
      history.push({ role: 'user', content: text });
      input.value = '';
      setLoading(true);

      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      })
        .then((res) => {
          if (!res.ok) {
            return res.json().catch(() => ({})).then((data) => {
              throw new Error(data?.details || data?.error || `Server error ${res.status}`);
            });
          }
          return res.text();
        })
        .then((reply) => {
          history.push({ role: 'assistant', content: reply });
          appendMessage('bot', reply);
        })
        .catch((err) => {
          appendMessage('error', `Error: ${err.message}`);
        })
        .finally(() => setLoading(false));
    }

    function appendMessage(type, text) {
      const div = document.createElement('div');
      div.className = `cw-msg cw-${type}`;
      if (type === 'bot') {
        div.innerHTML = renderMarkdown(text);
      } else {
        div.textContent = text;
      }
      msgs.insertBefore(div, typing);
      msgs.scrollTop = msgs.scrollHeight;
    }

    function setLoading(loading) {
      sendBtn.disabled = loading;
      input.disabled = loading;
      typing.style.display = loading ? 'block' : 'none';
      msgs.scrollTop = msgs.scrollHeight;
    }
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function initializeMarkdownRenderer() {
    if (typeof window.markdownit === 'function') {
      markdownRenderer = window.markdownit({
        html: false,
        linkify: true,
        typographer: true,
        breaks: true,
      });
      return;
    }

    const existingScript = document.querySelector(`script[src="${MARKDOWN_IT_CDN}"]`);
    if (existingScript) {
      existingScript.addEventListener('load', () => {
        if (typeof window.markdownit === 'function') {
          markdownRenderer = window.markdownit({
            html: false,
            linkify: true,
            typographer: true,
            breaks: true,
          });
        }
      });
      return;
    }

    const mdScript = document.createElement('script');
    mdScript.src = MARKDOWN_IT_CDN;
    mdScript.async = true;
    mdScript.onload = () => {
      markdownRenderer = window.markdownit({
        html: false,
        linkify: true,
        typographer: true,
        breaks: true,
      });
    };
    mdScript.onerror = () => {
      console.warn('Markdown-it failed to load; falling back to plain text rendering.');
    };
    document.head.appendChild(mdScript);
  }

  function renderMarkdown(text) {
    if (typeof text !== 'string' || !text.trim()) return '';

    if (markdownRenderer) {
      return markdownRenderer.render(text);
    }

    return `<p>${escapeHtml(text).replace(/\r\n?|\n/g, '<br>')}</p>`;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
