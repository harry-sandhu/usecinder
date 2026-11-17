// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { Fragment } from 'react';
import type { ReactNode } from 'react';

interface TokenPattern {
  kind: string;
  regex: RegExp;
}

const sharedPatterns: TokenPattern[] = [
  { kind: 'comment', regex: /\/\/.*|\/\*[\s\S]*?\*\// },
  { kind: 'string', regex: /`(?:\\.|[^`])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/ },
  { kind: 'number', regex: /\b\d+(?:\.\d+)?\b/ },
  { kind: 'keyword', regex: /\b(?:import|from|export|default|return|const|let|var|if|else|for|while|await|async|new|class|extends|interface|type|function|try|catch|throw|null|undefined|true|false)\b/ },
  { kind: 'builtin', regex: /\b(?:Cinder|console|document|window|Promise|Array|Object|Map|Set|String|Number|Boolean|Date|fetch)\b/ },
  { kind: 'operator', regex: /=>|===|!==|==|!=|<=|>=|&&|\|\||\+\+|--|[=+\-*/%<>!?:|&]/ },
  { kind: 'punctuation', regex: /[{}()[\].,;]/ },
];

const bashPatterns: TokenPattern[] = [
  { kind: 'comment', regex: /#.*/ },
  { kind: 'builtin', regex: /\b(?:npm|pnpm|yarn|node|npx|git|cd|rm|cp|mv|echo|cat|ls|vite)\b/ },
  { kind: 'keyword', regex: /\b(?:run|install|add|remove|preview|build|dev)\b/ },
  { kind: 'operator', regex: /\|\||&&|\||[=]/ },
  { kind: 'number', regex: /\b\d+(?:\.\d+)?\b/ },
  { kind: 'string', regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/ },
  { kind: 'attr-name', regex: /--?[a-zA-Z][\w-]*/ },
];

const htmlPatterns: TokenPattern[] = [
  { kind: 'comment', regex: /<!--.*?-->/ },
  { kind: 'tag', regex: /<\/?[A-Za-z][A-Za-z0-9:-]*/ },
  { kind: 'attr-name', regex: /\b[a-zA-Z_:][-a-zA-Z0-9_:.]*(?==)/ },
  { kind: 'operator', regex: /=|\/>|>/ },
  { kind: 'string', regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/ },
  { kind: 'punctuation', regex: /[{}()[\].,;]/ },
];

const jsonPatterns: TokenPattern[] = [
  { kind: 'string', regex: /"(?:\\.|[^"\\])*"(?=\s*:)?/ },
  { kind: 'number', regex: /\b\d+(?:\.\d+)?\b/ },
  { kind: 'keyword', regex: /\b(?:true|false|null)\b/ },
  { kind: 'operator', regex: /:/ },
  { kind: 'punctuation', regex: /[{}\[\],]/ },
];

const cssPatterns: TokenPattern[] = [
  { kind: 'comment', regex: /\/\*[\s\S]*?\*\// },
  { kind: 'attr-name', regex: /\b[a-z-]+(?=\s*:)/i },
  { kind: 'number', regex: /#[0-9a-f]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%)?/i },
  { kind: 'keyword', regex: /\b(?:@media|@supports|flex|grid|block|inline|absolute|relative|sticky|solid|auto|inherit)\b/ },
  { kind: 'string', regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/ },
  { kind: 'punctuation', regex: /[{}:;(),.]/ },
];

function normalizeLanguage(language?: string) {
  const normalized = (language ?? '').toLowerCase();

  if (['ts', 'tsx', 'js', 'jsx', 'typescript', 'javascript'].includes(normalized)) {
    return 'ts';
  }

  if (['bash', 'sh', 'shell', 'zsh'].includes(normalized)) {
    return 'bash';
  }

  if (['html', 'xml'].includes(normalized)) {
    return 'html';
  }

  if (['json'].includes(normalized)) {
    return 'json';
  }

  if (['css'].includes(normalized)) {
    return 'css';
  }

  return 'plain';
}

function getPatterns(language?: string) {
  const normalizedLanguage = normalizeLanguage(language);

  if (normalizedLanguage === 'bash') {
    return bashPatterns;
  }

  if (normalizedLanguage === 'html') {
    return htmlPatterns;
  }

  if (normalizedLanguage === 'json') {
    return jsonPatterns;
  }

  if (normalizedLanguage === 'css') {
    return cssPatterns;
  }

  if (normalizedLanguage === 'ts') {
    return sharedPatterns;
  }

  return [];
}

function tokenizeLine(line: string, patterns: TokenPattern[]) {
  if (patterns.length === 0) {
    return [line];
  }

  const tokens: ReactNode[] = [];
  let remaining = line;
  let tokenIndex = 0;

  while (remaining.length > 0) {
    let selectedPattern: TokenPattern | undefined;
    let selectedMatch: RegExpExecArray | undefined;

    for (const pattern of patterns) {
      const match = pattern.regex.exec(remaining);
      if (!match || match.index === undefined) {
        continue;
      }

      if (!selectedMatch || match.index < selectedMatch.index || (match.index === selectedMatch.index && match[0].length > selectedMatch[0].length)) {
        selectedPattern = pattern;
        selectedMatch = match;
      }
    }

    if (!selectedPattern || !selectedMatch) {
      tokens.push(remaining);
      break;
    }

    if (selectedMatch.index > 0) {
      tokens.push(remaining.slice(0, selectedMatch.index));
    }

    tokens.push(
      <span key={`token-${tokenIndex}`} className={`code-token code-token-${selectedPattern.kind}`}>
        {selectedMatch[0]}
      </span>,
    );

    remaining = remaining.slice(selectedMatch.index + selectedMatch[0].length);
    tokenIndex += 1;
  }

  return tokens;
}

export function renderHighlightedCode(code: string, language?: string) {
  const patterns = getPatterns(language);
  const lines = code.replace(/\n$/, '').split('\n');

  return lines.map((line, index) => (
    <Fragment key={`line-${index}`}>
      {tokenizeLine(line, patterns)}
      {index < lines.length - 1 ? '\n' : null}
    </Fragment>
  ));
}
