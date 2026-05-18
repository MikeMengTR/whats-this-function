/**
 * 编程语言简易检测：关键词匹配。
 * 命中即返回；都不匹配返回 'unknown'，让 LLM 自行判断。
 */

export type Language =
  | 'python' | 'javascript' | 'typescript' | 'java' | 'cpp' | 'c'
  | 'rust' | 'go' | 'csharp' | 'ruby' | 'php' | 'swift' | 'kotlin'
  | 'shell' | 'sql' | 'html' | 'css' | 'json' | 'yaml'
  | 'unknown';

interface Rule {
  lang: Language;
  test: (s: string) => boolean;
}

const RULES: Rule[] = [
  // 顺序很重要：先匹配特征更明显的
  { lang: 'typescript', test: (s) => /\b(interface|type)\s+\w+\s*[{=]|: \w+(\[\])?\s*[,)=]|as\s+\w+/.test(s) && /\b(const|let|import)\b/.test(s) },
  { lang: 'python',     test: (s) => /\bdef\s+\w+\s*\(|\bimport\s+\w+|\bfrom\s+\w+\s+import\b|\bprint\s*\(|^\s*#[^!]/m.test(s) },
  { lang: 'javascript', test: (s) => /\b(const|let|var)\s+\w+|=>|console\.(log|error)|require\(|module\.exports/.test(s) },
  { lang: 'java',       test: (s) => /\b(public|private|protected)\b.*\bclass\b|System\.out\.println|new\s+\w+<.*>\(/.test(s) },
  { lang: 'kotlin',     test: (s) => /\bfun\s+\w+\s*\(|\bval\s+\w+|\bvar\s+\w+\s*[:=]/.test(s) && /\bprintln\b/.test(s) },
  { lang: 'cpp',        test: (s) => /#include\s*<\w+>|\bstd::|::\w+\(|\bcout\s*<<|\bcin\s*>>/.test(s) },
  { lang: 'c',          test: (s) => /#include\s*<\w+\.h>|\bprintf\s*\(|\bint\s+main\s*\(/.test(s) },
  { lang: 'rust',       test: (s) => /\bfn\s+\w+\s*\(|\blet\s+mut\b|->\s*\w+\s*\{|\bimpl\b|::\w+\(/.test(s) },
  { lang: 'go',         test: (s) => /\bpackage\s+\w+|\bfunc\s+\w+\s*\(|\bfmt\.|:=/.test(s) },
  { lang: 'csharp',     test: (s) => /\busing\s+System;|\bnamespace\s+\w+|Console\.WriteLine/.test(s) },
  { lang: 'ruby',       test: (s) => /\bdef\s+\w+\s*$|\bend\s*$|\bputs\b|\brequire\s+['"]/m.test(s) },
  { lang: 'php',        test: (s) => /<\?php|\$\w+\s*=|\becho\s+/.test(s) },
  { lang: 'swift',      test: (s) => /\bfunc\s+\w+|\blet\s+\w+\s*[:=]|\bvar\s+\w+\s*[:=]|\bprint\(/.test(s) && /->/.test(s) },
  { lang: 'sql',        test: (s) => /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(s) && /\b(FROM|INTO|TABLE|WHERE)\b/i.test(s) },
  { lang: 'shell',      test: (s) => /^#!\/(bin|usr)\/(bash|sh|zsh)/m.test(s) || /\$\{?\w+\}?|^\s*(if|then|fi|for|done|case|esac)\b/m.test(s) },
  { lang: 'html',       test: (s) => /<!DOCTYPE html|<html[\s>]|<\/\w+>/i.test(s) },
  { lang: 'css',        test: (s) => /\{[^{}]*?:[^{}]*?;[^{}]*?\}/.test(s) && /[\.#]?[\w-]+\s*\{/.test(s) },
  { lang: 'json',       test: (s) => /^\s*[\[{]/.test(s) && /[\]}]\s*$/.test(s) && /"\w+"\s*:/.test(s) },
  { lang: 'yaml',       test: (s) => /^\s*\w[\w-]*:\s*(\S|$)/m.test(s) && !/[{};]/.test(s) },
];

export function detectLanguage(code: string): Language {
  if (!code || !code.trim()) return 'unknown';
  for (const r of RULES) {
    try {
      if (r.test(code)) return r.lang;
    } catch {
      /* 单条规则错误不影响其他规则 */
    }
  }
  return 'unknown';
}
