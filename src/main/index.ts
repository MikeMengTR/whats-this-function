import { app, BrowserWindow, ipcMain, clipboard } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { initTray, destroyTray } from './tray';
import { createPopup, showPopupAtCursor, hidePopup, getPopup } from './windowManager';
import { startKeyListener, stopKeyListener } from './keyListener';
import { acquireSelectedCode } from './codeAcquisition';
import { detectLanguage, Language } from './languageDetector';
import { quickExplain, detailedExplain, chat, OpenAIProviderError } from './llm/llmService';
import { getConfig, getConfigPath } from './store';
import { cacheGet, cacheSet, cacheStats } from './cache';

/**
 * 从旧名字 codewhisper 的 userData 目录把 config.json 拷到当前的 wtf 目录。
 * 必须在任何 electron-store 调用之前执行（否则 store 会先创建空 config 把迁移路径堵死）。
 * 不调用 getConfigPath/getConfig；用 fs 自己定位路径。
 */
function migrateLegacyConfig(): void {
  try {
    const userData = app.getPath('userData'); // 当前 app 的 userData 目录
    const currentPath = path.join(userData, 'config.json');
    if (fs.existsSync(currentPath)) {
      // 已存在：可能是 electron-store 已经初始化过；若内容只有默认值且老 config 有 apiKey，可以"补"一次
      const parentDir = path.dirname(userData);
      const legacyPath = path.join(parentDir, 'codewhisper', 'config.json');
      if (!fs.existsSync(legacyPath)) return;
      try {
        const cur = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
        if (cur && typeof cur.apiKey === 'string' && cur.apiKey.length > 0) return; // 已有 key 不覆盖
        const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
        if (!legacy || typeof legacy.apiKey !== 'string' || legacy.apiKey.length === 0) return;
        const merged = { ...cur, ...legacy };
        fs.writeFileSync(currentPath, JSON.stringify(merged, null, 2), 'utf8');
        console.log(`[WTF] 已从旧目录 codewhisper 把 apiKey 等配置补到 ${currentPath}`);
      } catch (e) {
        console.warn('[WTF] 旧配置解析失败，跳过迁移:', (e as Error).message);
      }
      return;
    }
    // 当前不存在：纯拷贝
    const legacyPath = path.join(path.dirname(userData), 'codewhisper', 'config.json');
    if (!fs.existsSync(legacyPath)) return;
    fs.mkdirSync(path.dirname(currentPath), { recursive: true });
    fs.copyFileSync(legacyPath, currentPath);
    console.log(`[WTF] 已从旧名字目录迁移配置: ${legacyPath} → ${currentPath}`);
  } catch (e) {
    console.warn('[WTF] 配置迁移失败（不影响启动）:', (e as Error).message);
  }
}

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// ── 运行时状态 ──
let isEnabled = true;

interface CurrentContext {
  code: string;
  language: Language;
  detail?: string;             // 缓存详解，避免重复调用
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}

let current: CurrentContext | null = null;
let activeAbort: AbortController | null = null;

function setEnabled(value: boolean): void {
  isEnabled = value;
  console.log('[WTF] 监听状态:', value ? '已启用' : '已暂停');
}

function abortPrevious(): void {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
}

function sendToPopup(channel: string, payload?: unknown): void {
  const win = getPopup();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function describeError(err: unknown): string {
  if (err instanceof OpenAIProviderError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

// ─────────────── 触发主流程 ───────────────
async function triggerExplain(): Promise<void> {
  if (!isEnabled) {
    console.log('[WTF] 已暂停，忽略触发');
    return;
  }
  console.log('[WTF] 触发解读');

  abortPrevious();

  const acquired = await acquireSelectedCode();
  if (!acquired) {
    showPopupAtCursor({
      code: '',
      explanation: '⚠️ 剪贴板为空。请先选中并 Ctrl+C 复制代码，再双击 Ctrl 触发。',
    });
    return;
  }

  const code = acquired.code;
  const language = detectLanguage(code);
  console.log(`[WTF] 代码 ${code.length} 字符，检测语言: ${language}`);

  current = { code, language, chatHistory: [] };

  // 1) 弹出（清空 UI，准备接收流式内容）
  showPopupAtCursor({ code, explanation: '' });

  // 2) 缓存命中直接显示
  const cached = cacheGet(code, language, 'quick');
  if (cached) {
    console.log('[WTF] 速览命中缓存');
    sendToPopup('whisper:show-quick', { code, explanation: cached });
    sendToPopup('whisper:quick-complete');
    return;
  }

  // 3) 流式调用 LLM 速览
  sendToPopup('whisper:loading');
  const ctrl = new AbortController();
  activeAbort = ctrl;
  const tStart = Date.now();
  let firstChunkAt = 0;
  try {
    const explanation = await quickExplain({
      code, language, signal: ctrl.signal,
      onChunk: (text) => {
        if (!firstChunkAt) {
          firstChunkAt = Date.now();
          console.log(`[WTF] 速览首字节 ${firstChunkAt - tStart}ms`);
        }
        sendToPopup('whisper:quick-chunk', { text });
      },
    });
    if (ctrl.signal.aborted) return;
    console.log(`[WTF] 速览完成 ${Date.now() - tStart}ms, 共 ${explanation.length} 字`);
    cacheSet(code, language, 'quick', explanation);
    sendToPopup('whisper:quick-complete');
  } catch (err) {
    if (ctrl.signal.aborted) return;
    const msg = describeError(err);
    console.error('[WTF] 速览失败:', msg);
    sendToPopup('whisper:error', { message: msg });
  } finally {
    if (activeAbort === ctrl) activeAbort = null;
  }
}

// ─────────────── 详解请求 ───────────────
async function handleRequestDetail(): Promise<void> {
  if (!current) return;

  // 本会话已有缓存
  if (current.detail) {
    sendToPopup('whisper:show-detail', { content: current.detail });
    return;
  }
  // 跨会话 LRU 缓存
  const cached = cacheGet(current.code, current.language, 'detail');
  if (cached) {
    console.log('[WTF] 详解命中缓存');
    current.detail = cached;
    sendToPopup('whisper:show-detail', { content: cached });
    return;
  }

  // 切到详解视图（content="" 让 renderer 清空并进入流式模式）
  sendToPopup('whisper:show-detail', { content: '' });
  sendToPopup('whisper:loading');

  const ctrl = new AbortController();
  abortPrevious();
  activeAbort = ctrl;
  const tStart = Date.now();
  let firstChunkAt = 0;

  try {
    const content = await detailedExplain({
      code: current.code,
      language: current.language,
      signal: ctrl.signal,
      onChunk: (text) => {
        if (!firstChunkAt) {
          firstChunkAt = Date.now();
          console.log(`[WTF] 详解首字节 ${firstChunkAt - tStart}ms`);
        }
        sendToPopup('whisper:detail-chunk', { text });
      },
    });
    if (ctrl.signal.aborted) return;
    console.log(`[WTF] 详解完成 ${Date.now() - tStart}ms, 共 ${content.length} 字`);
    if (current) current.detail = content;
    cacheSet(current!.code, current!.language, 'detail', content);
    sendToPopup('whisper:detail-complete');
  } catch (err) {
    if (ctrl.signal.aborted) return;
    const msg = describeError(err);
    console.error('[WTF] 详解失败:', msg);
    sendToPopup('whisper:error', { message: msg });
  } finally {
    if (activeAbort === ctrl) activeAbort = null;
  }
}

// ─────────────── 追问 ───────────────
async function handleChat(text: string): Promise<void> {
  if (!current) {
    sendToPopup('whisper:error', { message: '当前没有解读上下文' });
    return;
  }
  const userMsg = (text || '').trim();
  if (!userMsg) return;

  current.chatHistory.push({ role: 'user', content: userMsg });

  // 最多 10 轮 = 20 条消息（4.6 节）
  const MAX_HISTORY = 20;
  if (current.chatHistory.length > MAX_HISTORY) {
    current.chatHistory = current.chatHistory.slice(-MAX_HISTORY);
  }

  const ctrl = new AbortController();
  abortPrevious();
  activeAbort = ctrl;

  let assistantBuf = '';
  try {
    await chat({
      code: current.code,
      language: current.language,
      history: current.chatHistory,
      signal: ctrl.signal,
      onChunk: (chunk) => {
        assistantBuf += chunk;
        sendToPopup('whisper:chat-chunk', { text: chunk });
      },
    });
    if (current) current.chatHistory.push({ role: 'assistant', content: assistantBuf });
    sendToPopup('whisper:chat-complete');
  } catch (err) {
    if (ctrl.signal.aborted) return;
    const msg = describeError(err);
    console.error('[WTF] 追问失败:', msg);
    sendToPopup('whisper:error', { message: msg });
  } finally {
    if (activeAbort === ctrl) activeAbort = null;
  }
}

// ─────────────── IPC 注册 ───────────────
ipcMain.on('whisper:request-detail', () => {
  void handleRequestDetail();
});

ipcMain.on('whisper:send-chat', (_e, { text }: { text: string }) => {
  void handleChat(text);
});

ipcMain.on('whisper:copy', (_e, { text }: { text: string }) => {
  if (typeof text === 'string' && text.length > 0) clipboard.writeText(text);
});

// ─────────────── 启动 ───────────────
app.whenReady().then(() => {
  console.log('[WTF] 应用启动');
  migrateLegacyConfig();
  console.log('[WTF] 配置文件:', getConfigPath());
  const cfg = getConfig();
  console.log(`[WTF] LLM 配置: provider=${cfg.provider}, baseUrl=${cfg.baseUrl}, model=${cfg.model}, thinking=${cfg.thinking}, apiKey=${cfg.apiKey ? '已设置' : '未设置'}`);

  createPopup();

  initTray({
    isEnabled: () => isEnabled,
    onToggleEnabled: setEnabled,
    onTriggerExplain: triggerExplain,
    onQuit: () => app.quit(),
  });

  const mode = startKeyListener({ onTrigger: triggerExplain });
  console.log('[WTF] 键盘监听模式:', mode);
  console.log('[WTF] 就绪。' + (mode === 'uiohook'
    ? '选中代码 → Ctrl+C → 双击 Ctrl。'
    : mode === 'fallback'
      ? '降级模式：选中代码 → Ctrl+C → Ctrl+Shift+K。'
      : '键盘监听未启用，仅可从托盘触发。'));

  if (!cfg.apiKey) {
    console.warn('[WTF] ⚠️ 未配置 API Key。请编辑 ' + getConfigPath() + ' 设置 apiKey，或设置环境变量 DEEPSEEK_API_KEY。');
  }
});

app.on('window-all-closed', (e: Event) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  abortPrevious();
  stopKeyListener();
  destroyTray();
});

app.on('second-instance', () => {
  console.log('[WTF] 检测到第二个实例尝试启动，已忽略');
});
