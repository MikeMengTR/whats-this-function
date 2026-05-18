/**
 * 配置持久化（electron-store）。
 *
 * 文件位置：app.getPath('userData')/config.json
 * - Windows: %APPDATA%/wtf/config.json
 * - macOS:   ~/Library/Application Support/wtf/config.json
 * - Linux:   ~/.config/wtf/config.json
 *
 * 阶段三未实现设置 UI，用户可直接编辑该 JSON 文件，
 * 或通过环境变量 DEEPSEEK_API_KEY / OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL 覆盖。
 */

// electron-store 在 v9 起为 ESM-only；我们锁定 v8 以保持 CJS 兼容
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ElectronStore = require('electron-store') as new <T>(opts?: { defaults?: T; name?: string }) => {
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
  set(values: Partial<T>): void;
  store: T;
  path: string;
};

export type Provider = 'openai-compat' | 'ollama' | 'claude';

/**
 * 思考模式（DeepSeek 等推理模型）：
 * - 'disabled' ：关闭思考，最快、最便宜（推荐用于速览/详解这种简单任务）
 * - 'enabled'  ：开启思考（模型默认），慢 2~3 倍但答案更稳
 * - 'auto'     ：不传 thinking 参数，由服务端默认决定（兼容非 DeepSeek 的 OpenAI 兼容接口）
 */
export type ThinkingMode = 'auto' | 'disabled' | 'enabled';

export interface Config {
  provider: Provider;
  apiKey: string;
  baseUrl: string;
  model: string;
  thinking: ThinkingMode;
  doubleTapThreshold: number; // ms
  autoCopy: boolean;          // 是否自动模拟 Ctrl+C（P1）
  explainLanguage: string;    // 解释输出语言
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  autoLaunch: boolean;
}

const DEFAULTS: Config = {
  provider: 'openai-compat',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  thinking: 'disabled',  // 默认关闭思考，3.5 倍首字加速
  doubleTapThreshold: 300,
  autoCopy: false, // 阶段二默认 false：用户自己 Ctrl+C；阶段五再切 true
  explainLanguage: '简体中文',
  difficulty: 'beginner',
  autoLaunch: false,
};

let storeInstance: ReturnType<typeof createStore> | null = null;

function createStore() {
  return new ElectronStore<Config>({
    name: 'config',
    defaults: DEFAULTS,
  });
}

function getStore() {
  if (!storeInstance) storeInstance = createStore();
  return storeInstance;
}

function envOverrides(): Partial<Config> {
  const out: Partial<Config> = {};
  if (process.env.DEEPSEEK_API_KEY) out.apiKey = process.env.DEEPSEEK_API_KEY;
  if (process.env.OPENAI_API_KEY) out.apiKey = process.env.OPENAI_API_KEY;
  if (process.env.CODEWHISPER_API_KEY) out.apiKey = process.env.CODEWHISPER_API_KEY;
  if (process.env.CODEWHISPER_BASE_URL) out.baseUrl = process.env.CODEWHISPER_BASE_URL;
  if (process.env.CODEWHISPER_MODEL) out.model = process.env.CODEWHISPER_MODEL;
  return out;
}

export function getConfig(): Config {
  const stored = getStore().store;
  return { ...stored, ...envOverrides() };
}

export function setConfig(patch: Partial<Config>): void {
  getStore().set(patch);
}

export function getConfigPath(): string {
  return getStore().path;
}
