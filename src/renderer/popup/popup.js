/* WTF 浮窗 Renderer */
(() => {
  'use strict';

  // marked 已通过 <script> 注入到 window.marked
  const marked = window.marked;
  if (marked && typeof marked.setOptions === 'function') {
    marked.setOptions({ breaks: true, gfm: true });
  }

  const $ = (id) => document.getElementById(id);

  const els = {
    card:         $('card'),
    titleCode:    $('title-code'),
    btnPin:       $('btn-pin'),
    btnClose:     $('btn-close'),

    statusEmpty:  $('status-empty'),
    statusLoading:$('status-loading'),
    statusError:  $('status-error'),
    errorText:    $('error-text'),
    loadingText:  $('loading-text'),

    explanation:  $('explanation'),
    detail:       $('detail'),
    chat:         $('chat'),
    chatMessages: $('chat-messages'),

    actionsQuick: $('actions-quick'),
    btnCopy:      $('btn-copy'),
    btnDetail:    $('btn-detail'),

    chatInputRow: $('chat-input-row'),
    chatInput:    $('chat-input'),
    btnSend:      $('btn-send'),

    toast:        $('toast'),
  };

  // ── 状态 ──
  let currentCode = '';
  let viewMode = 'empty';   // empty | quick | detail
  let isLoading = false;    // 任何 LLM 调用进行中
  let streamingMsg = null;  // 当前流式 AI 消息 DOM（追问）
  let streamingBuf = '';    // 追问当前流式缓冲
  let quickBuf = '';        // 速览流式缓冲
  let detailBuf = '';       // 详解流式缓冲

  // 内容变化后通知主进程 auto-fit 窗口高度（rAF 防抖）
  // 测量策略：card 自身被 100vh 锁定，所以分别量 titlebar/content/footer 的自然尺寸
  let _autosizeRaf = 0;
  function requestAutosize() {
    if (_autosizeRaf) cancelAnimationFrame(_autosizeRaf);
    _autosizeRaf = requestAnimationFrame(() => {
      _autosizeRaf = 0;
      const titlebar = els.card.querySelector('.titlebar');
      const content  = $('content');
      const footer   = els.card.querySelector('.footer');
      let h = 2; // 卡片上下边框
      if (titlebar) h += titlebar.offsetHeight;
      if (content)  h += content.scrollHeight; // 内容的自然高度（无 scroll 时所需）
      if (footer)   h += footer.offsetHeight;
      window.whisper.autosize(Math.ceil(h));
    });
  }

  // ── 视图切换 ──
  function setView(mode) {
    viewMode = mode;
    els.statusEmpty.classList.toggle('hidden', mode !== 'empty');
    els.statusError.classList.add('hidden');
    els.explanation.classList.toggle('hidden', mode === 'empty' || mode === 'loading-only');
    els.detail.classList.toggle('hidden', mode !== 'detail');
    els.chat.classList.toggle('hidden', mode !== 'detail');
    els.actionsQuick.classList.toggle('hidden', mode === 'detail');
    els.chatInputRow.classList.toggle('hidden', mode !== 'detail');
    requestAutosize();
  }

  function setLoading(on, text) {
    isLoading = on;
    els.statusLoading.classList.toggle('hidden', !on);
    if (text) els.loadingText.textContent = text;
    els.btnDetail.disabled = on;
    els.btnSend.disabled = on;
    els.chatInput.disabled = on;
  }

  function showError(message) {
    if (els.errorText) {
      els.errorText.textContent = message;
    } else {
      els.statusError.textContent = message;
    }
    els.statusError.classList.remove('hidden');
    setLoading(false);
    requestAutosize();
  }

  // ── 内容渲染 ──
  function renderMarkdown(target, text) {
    if (marked && typeof marked.parse === 'function') {
      try {
        target.innerHTML = marked.parse(text || '');
        return;
      } catch (e) {
        console.error('Markdown 渲染失败:', e);
      }
    }
    target.textContent = text || '';
  }

  function showQuick(payload) {
    const code = (payload && payload.code) || '';
    const explanation = (payload && payload.explanation) || '';
    currentCode = code;
    els.titleCode.textContent = code || '（无代码）';
    els.titleCode.title = code;
    quickBuf = explanation;
    renderMarkdown(els.explanation, explanation);
    els.explanation.classList.toggle('streaming', false);
    els.detail.innerHTML = '';
    els.chatMessages.innerHTML = '';
    streamingMsg = null;
    streamingBuf = '';
    detailBuf = '';
    // 非空 explanation 视为终态（缓存命中）；空则进入流式接收态
    if (!explanation) els.explanation.classList.add('streaming');
    setLoading(false);
    setView('quick');
    requestAutosize();
  }

  function handleQuickChunk(payload) {
    const text = (payload && payload.text) || '';
    if (!text) return;
    setLoading(false);  // 首 chunk 到达，关掉 loading 指示
    quickBuf += text;
    renderMarkdown(els.explanation, quickBuf);
    els.explanation.classList.add('streaming');
    requestAutosize();
  }

  function handleQuickComplete() {
    els.explanation.classList.remove('streaming');
    setLoading(false);
    requestAutosize();
  }

  function showDetail(payload) {
    const content = (payload && payload.content) || '';
    detailBuf = content;
    renderMarkdown(els.detail, content);
    els.detail.classList.toggle('streaming', !content);
    setLoading(false);
    setView('detail');
    window.whisper.expandForDetail();  // 通知主进程切换 currentView
    requestAutosize();
    setTimeout(() => els.chatInput.focus(), 80);
  }

  function handleDetailChunk(payload) {
    const text = (payload && payload.text) || '';
    if (!text) return;
    setLoading(false);
    detailBuf += text;
    renderMarkdown(els.detail, detailBuf);
    els.detail.classList.add('streaming');
    requestAutosize();
  }

  function handleDetailComplete() {
    els.detail.classList.remove('streaming');
    setLoading(false);
    requestAutosize();
    setTimeout(() => els.chatInput.focus(), 50);
  }

  function appendChatMessage(role, text) {
    const msg = document.createElement('div');
    msg.className = `msg msg-${role}`;
    if (role === 'ai') {
      msg.classList.add('markdown');
      renderMarkdown(msg, text);
    } else {
      msg.textContent = text;
    }
    els.chatMessages.appendChild(msg);
    msg.scrollIntoView({ behavior: 'smooth', block: 'end' });
    return msg;
  }

  function handleChatChunk(payload) {
    const text = (payload && payload.text) || '';
    if (!streamingMsg) {
      streamingMsg = appendChatMessage('ai', '');
      streamingMsg.classList.add('streaming');
      streamingBuf = '';
      setLoading(false);
    }
    streamingBuf += text;
    renderMarkdown(streamingMsg, streamingBuf);
    streamingMsg.classList.add('streaming');
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
    requestAutosize();
  }

  function handleChatComplete() {
    if (streamingMsg) {
      streamingMsg.classList.remove('streaming');
      streamingMsg = null;
      streamingBuf = '';
    }
    setLoading(false);
    requestAutosize();
    setTimeout(() => els.chatInput.focus(), 50);
  }

  // ── Toast ──
  let toastTimer = 0;
  function showToast(text) {
    els.toast.textContent = text;
    els.toast.classList.remove('hidden');
    // 重启动画
    els.toast.style.animation = 'none';
    void els.toast.offsetWidth;
    els.toast.style.animation = '';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 1500);
  }

  // ── 事件 ──
  els.btnClose.addEventListener('click', () => window.whisper.close());

  els.btnPin.addEventListener('click', () => window.whisper.togglePin());

  els.btnCopy.addEventListener('click', () => {
    if (currentCode) {
      window.whisper.copy(currentCode);
      showToast('已复制');
    }
  });

  els.btnDetail.addEventListener('click', () => {
    if (isLoading || !currentCode) return;
    setLoading(true, '生成详解');
    window.whisper.requestDetail();
  });

  function sendChat() {
    const text = els.chatInput.value.trim();
    if (!text || isLoading) return;
    appendChatMessage('user', text);
    requestAutosize();
    els.chatInput.value = '';
    setLoading(true, '思考中');
    window.whisper.sendChat(text);
  }

  els.btnSend.addEventListener('click', sendChat);

  els.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendChat();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.activeElement === els.chatInput) {
        els.chatInput.blur();
      } else {
        window.whisper.close();
      }
    }
  });

  // ── IPC ──
  window.whisper.onShowQuick(showQuick);
  window.whisper.onQuickChunk(handleQuickChunk);
  window.whisper.onQuickComplete(handleQuickComplete);
  window.whisper.onShowDetail(showDetail);
  window.whisper.onDetailChunk(handleDetailChunk);
  window.whisper.onDetailComplete(handleDetailComplete);
  window.whisper.onLoading(() => setLoading(true, '解读中'));
  window.whisper.onError((p) => showError((p && p.message) || '未知错误'));
  window.whisper.onChatChunk(handleChatChunk);
  window.whisper.onChatComplete(handleChatComplete);
  window.whisper.onPinState(({ pinned }) => {
    els.btnPin.classList.toggle('active', !!pinned);
    els.btnPin.title = pinned ? '已固定（点击取消）' : '固定窗口';
  });

  setView('empty');
})();
