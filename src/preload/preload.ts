import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export interface QuickPayload {
  code: string;
  explanation?: string;
}

export interface DetailPayload {
  content: string;
}

export interface ChatChunkPayload {
  text: string;
}

export interface ErrorPayload {
  message: string;
}

const api = {
  // Main → Renderer 监听
  onShowQuick(handler: (payload: QuickPayload) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: QuickPayload) => handler(payload);
    ipcRenderer.on('whisper:show-quick', listener);
    return () => ipcRenderer.removeListener('whisper:show-quick', listener);
  },
  onQuickChunk(handler: (payload: ChatChunkPayload) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: ChatChunkPayload) => handler(payload);
    ipcRenderer.on('whisper:quick-chunk', listener);
    return () => ipcRenderer.removeListener('whisper:quick-chunk', listener);
  },
  onQuickComplete(handler: () => void): () => void {
    const listener = () => handler();
    ipcRenderer.on('whisper:quick-complete', listener);
    return () => ipcRenderer.removeListener('whisper:quick-complete', listener);
  },
  onShowDetail(handler: (payload: DetailPayload) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: DetailPayload) => handler(payload);
    ipcRenderer.on('whisper:show-detail', listener);
    return () => ipcRenderer.removeListener('whisper:show-detail', listener);
  },
  onDetailChunk(handler: (payload: ChatChunkPayload) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: ChatChunkPayload) => handler(payload);
    ipcRenderer.on('whisper:detail-chunk', listener);
    return () => ipcRenderer.removeListener('whisper:detail-chunk', listener);
  },
  onDetailComplete(handler: () => void): () => void {
    const listener = () => handler();
    ipcRenderer.on('whisper:detail-complete', listener);
    return () => ipcRenderer.removeListener('whisper:detail-complete', listener);
  },
  onChatChunk(handler: (payload: ChatChunkPayload) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: ChatChunkPayload) => handler(payload);
    ipcRenderer.on('whisper:chat-chunk', listener);
    return () => ipcRenderer.removeListener('whisper:chat-chunk', listener);
  },
  onChatComplete(handler: () => void): () => void {
    const listener = () => handler();
    ipcRenderer.on('whisper:chat-complete', listener);
    return () => ipcRenderer.removeListener('whisper:chat-complete', listener);
  },
  onLoading(handler: () => void): () => void {
    const listener = () => handler();
    ipcRenderer.on('whisper:loading', listener);
    return () => ipcRenderer.removeListener('whisper:loading', listener);
  },
  onError(handler: (payload: ErrorPayload) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: ErrorPayload) => handler(payload);
    ipcRenderer.on('whisper:error', listener);
    return () => ipcRenderer.removeListener('whisper:error', listener);
  },
  onPinState(handler: (payload: { pinned: boolean }) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: { pinned: boolean }) => handler(payload);
    ipcRenderer.on('whisper:pin-state', listener);
    return () => ipcRenderer.removeListener('whisper:pin-state', listener);
  },

  // Renderer → Main 发送
  requestDetail(): void {
    ipcRenderer.send('whisper:request-detail');
  },
  sendChat(text: string): void {
    ipcRenderer.send('whisper:send-chat', { text });
  },
  copy(text: string): void {
    ipcRenderer.send('whisper:copy', { text });
  },
  togglePin(): void {
    ipcRenderer.send('whisper:toggle-pin');
  },
  close(): void {
    ipcRenderer.send('whisper:close');
  },
  /** 切到详解视图时通知主进程 */
  expandForDetail(): void {
    ipcRenderer.send('whisper:expand-for-detail');
  },
  /** 内容自然高度变化后通知主进程进行 auto-fit */
  autosize(height: number): void {
    ipcRenderer.send('whisper:autosize', { height });
  },
};

contextBridge.exposeInMainWorld('whisper', api);

export type WhisperApi = typeof api;
