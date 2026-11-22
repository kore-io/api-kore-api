import { EMAIL_THEME } from './email-theme';

/** Formato comum dos e-mails da F0 (Voz & Microcopy, E-mails transacionais). */
export const SUPPORT_LINE = 'Dúvidas? Escreva para suporte@kore.com.br.';

export function escapeHtml({ text }: { text: string }): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailBlock {
  kind: 'paragraph' | 'highlight' | 'button' | 'quote';
  text: string;
  href?: string;
}

/** Quadro de 600 px, com o pré-cabeçalho escondido (só aparece na prévia da caixa). */
export function renderEmailHtml({
  preheader,
  blocks,
  footer,
}: {
  preheader: string;
  blocks: EmailBlock[];
  footer: string;
}): string {
  const body = blocks
    .map((block) => {
      const text = escapeHtml({ text: block.text });
      if (block.kind === 'highlight') {
        return `<p style="font-size:32px;letter-spacing:4px;font-weight:bold;margin:24px 0">${text}</p>`;
      }
      if (block.kind === 'quote') {
        return `<blockquote style="margin:0 0 16px;padding:0 0 0 16px;border-left:3px solid ${EMAIL_THEME.mutedText};font-style:italic">${text}</blockquote>`;
      }
      if (block.kind === 'button') {
        const href = escapeHtml({ text: block.href ?? '' });
        return `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;padding:12px 24px;border-radius:8px;background:${EMAIL_THEME.buttonBackground};color:${EMAIL_THEME.buttonText};text-decoration:none">${text}</a></p>`;
      }
      return `<p style="margin:0 0 16px">${text}</p>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:${EMAIL_THEME.pageBackground}">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml({ text: preheader })}</span>
<table role="presentation" width="100%"><tr><td align="center">
<table role="presentation" width="600" style="max-width:600px;background:${EMAIL_THEME.cardBackground};padding:32px;font-family:Arial,sans-serif;color:${EMAIL_THEME.text}">
<tr><td><p style="font-size:20px;font-weight:bold;margin:0 0 24px">Kore</p>
${body}
<p style="margin:24px 0 16px">${escapeHtml({ text: SUPPORT_LINE })}</p>
<p style="font-size:12px;color:${EMAIL_THEME.mutedText};margin:0">${escapeHtml({ text: footer })}</p>
</td></tr></table></td></tr></table></body></html>`;
}
