/**
 * LLM 统一服务层。
 * 阶段三只接 OpenAI 兼容（DeepSeek 默认），未来按 provider 字段加分支。
 */

import { OpenAIProvider, ChatMessage, OpenAIProviderError } from './openaiProvider';
import { getConfig } from '../store';
import { quickExplainPrompt, detailedExplainPrompt, chatSystemPrompt } from '../prompts';
import { Language } from '../languageDetector';

function makeProvider(): OpenAIProvider {
  const cfg = getConfig();
  if (cfg.provider !== 'openai-compat') {
    // 阶段三：其他 provider 尚未实现，给出明确错误而不是默默切换
    throw new OpenAIProviderError(`暂不支持 provider="${cfg.provider}"，阶段三只实现了 openai-compat`);
  }
  return new OpenAIProvider({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    thinking: cfg.thinking,
  });
}

export interface ExplainArgs {
  code: string;
  language: Language;
  signal?: AbortSignal;
  /** 传入则走流式，每个 chunk 立即回调；否则走非流式 */
  onChunk?: (text: string) => void;
}

export async function quickExplain({ code, language, signal, onChunk }: ExplainArgs): Promise<string> {
  const provider = makeProvider();
  const messages: ChatMessage[] = [
    { role: 'user', content: quickExplainPrompt({ code, language }) },
  ];
  // 提高 maxTokens：推理模型会先消耗 token 在 reasoning_content 上才输出 content
  if (onChunk) {
    const full = await provider.stream(messages, { signal, onChunk, temperature: 0.2, maxTokens: 1024 });
    return full.trim();
  }
  const text = await provider.complete(messages, { signal, temperature: 0.2, maxTokens: 1024 });
  return text.trim();
}

export async function detailedExplain({ code, language, signal, onChunk }: ExplainArgs): Promise<string> {
  const provider = makeProvider();
  const messages: ChatMessage[] = [
    { role: 'user', content: detailedExplainPrompt({ code, language }) },
  ];
  if (onChunk) {
    const full = await provider.stream(messages, { signal, onChunk, temperature: 0.3, maxTokens: 4096 });
    return full.trim();
  }
  const text = await provider.complete(messages, { signal, temperature: 0.3, maxTokens: 4096 });
  return text.trim();
}

export interface ChatArgs {
  code: string;
  language: Language;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  signal?: AbortSignal;
  onChunk: (text: string) => void;
}

export async function chat({ code, language, history, signal, onChunk }: ChatArgs): Promise<string> {
  const provider = makeProvider();
  const messages: ChatMessage[] = [
    { role: 'system', content: chatSystemPrompt({ code, language }) },
    ...history,
  ];
  return provider.stream(messages, { signal, onChunk, temperature: 0.4, maxTokens: 2048 });
}

export { OpenAIProviderError };
