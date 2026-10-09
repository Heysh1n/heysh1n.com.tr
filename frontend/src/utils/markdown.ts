import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import DOMPurify from 'isomorphic-dompurify';

/**
 * 1. Инициализация парсера marked с поддержкой:
 *    - GFM (таблицы, списки задач, перечеркивание, блоки кода)
 *    - LaTeX математических формул через KaTeX ($инлайн$ и $$блок$$)
 */
const marked = new Marked();

marked.use(
  markedKatex({
    throwOnError: false, // Не прерывать сборку при опечатках в синтаксисе TeX
    nonStandard: true,   // Поддержка $...$ инлайн-формул без строгих требований к пробелам
  })
);

// Включаем GFM и переносы строк по умолчанию
marked.setOptions({
  gfm: true,
  breaks: false,
});

/**
 * 2. Конфигурация санитизации HTML (DOMPurify).
 * Разрешает безопасные HTML-теги для таблиц, блоков кода и разметки MathML / KaTeX.
 */
const PURIFY_CONFIG: DOMPurify.Config = {
  USE_PROFILES: { html: true, mathMl: true, svg: true },
  ADD_TAGS: [
    // MathML теги для формул KaTeX
    'math', 'semantics', 'annotation', 'annotation-xml',
    'mrow', 'mi', 'mn', 'mo', 'msup', 'msub', 'msubsup',
    'mfrac', 'msqrt', 'mroot', 'mtable', 'mtr', 'mtd',
    'mover', 'munder', 'munderover', 'mspace', 'mtext',
    // Таблицы и блоки кода
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'pre', 'code', 'blockquote', 'hr', 'span', 'p', 'br',
  ],
  ADD_ATTR: [
    'aria-hidden', 'display', 'viewBox', 'xmlns', 'encoding',
    'class', 'style', 'target', 'rel', 'href', 'title', 'id',
  ],
};

/**
 * Конвертирует Lexical AST из Payload CMS в Markdown-строку.
 * Поддерживает параграфы, заголовки, списки, цитаты, код, ссылки и форматирование текста.
 */
export function lexicalToMarkdown(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;

  const candidate = content as Record<string, unknown>;
  const root = (candidate.root || candidate) as { children?: unknown[] };

  if (!root || !Array.isArray(root.children)) {
    return typeof content === 'string' ? content : '';
  }

  function serializeNode(node: unknown): string {
    if (!node) return '';
    if (typeof node === 'string') return node;

    const n = node as {
      type?: string;
      text?: string;
      format?: number;
      tag?: string;
      listType?: string;
      language?: string;
      children?: unknown[];
      fields?: { url?: string };
      url?: string;
    };

    if (n.type === 'text') {
      let text = n.text || '';
      if (typeof n.format === 'number') {
        if (n.format & 16) text = `\`${text}\``; // Code
        if (n.format & 1) text = `**${text}**`;  // Bold
        if (n.format & 2) text = `*${text}*`;    // Italic
        if (n.format & 4) text = `~~${text}~~`;  // Strikethrough
      }
      return text;
    }

    if (n.type === 'linebreak') return '\n';

    const childrenText = Array.isArray(n.children)
      ? n.children.map(serializeNode).join('')
      : '';

    switch (n.type) {
      case 'root':
        return childrenText;
      case 'paragraph':
        return `${childrenText}\n\n`;
      case 'heading': {
        const level = parseInt(String(n.tag || 'h3').replace('h', ''), 10) || 3;
        return `${'#'.repeat(level)} ${childrenText}\n\n`;
      }
      case 'quote':
        return `> ${childrenText}\n\n`;
      case 'list': {
        const isOrdered = n.listType === 'number';
        return (n.children || [])
          .map((item, i) => {
            const itemObj = item as { children?: unknown[] };
            const itemContent = Array.isArray(itemObj.children)
              ? itemObj.children.map(serializeNode).join('').trim()
              : '';
            return isOrdered ? `${i + 1}. ${itemContent}` : `- ${itemContent}`;
          })
          .join('\n') + '\n\n';
      }
      case 'listitem':
        return childrenText;
      case 'code':
        return `\`\`\`${n.language || ''}\n${childrenText || n.text || ''}\n\`\`\`\n\n`;
      case 'link':
      case 'autolink': {
        const href = n.fields?.url || n.url || '#';
        return `[${childrenText || href}](${href})`;
      }
      default:
        return childrenText;
    }
  }

  return root.children.map(serializeNode).join('').trim();
}

/**
 * Синхронный рендеринг Markdown в безопасный HTML с поддержкой LaTeX ($ / $$),
 * таблиц и блоков кода. Выполняется строго на этапе Astro build (SSG).
 * Zero Client JS: в браузер отдается готовый отрендеренный HTML.
 */
export function renderMarkdown(content: string): string {
  if (!content || typeof content !== 'string') {
    return '';
  }

  // Парсинг Markdown + KaTeX в HTML при сборке
  const rawHtml = marked.parse(content, { async: false }) as string;

  // Очистка от XSS с сохранением верстки таблиц и формул
  return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
}

/**
 * Универсальный рендерер контента из Payload CMS (принимает как raw markdown, так и Lexical AST).
 */
export function renderProjectContent(content: unknown): string {
  if (!content) return '';
  const markdown = lexicalToMarkdown(content);
  return renderMarkdown(markdown);
}