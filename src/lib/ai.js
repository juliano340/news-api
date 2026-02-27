const axios = require('axios');
const config = require('../config');

const enabled = config.useAI && Boolean(config.openRouterKey);

function sanitizeRawText(rawText) {
  return String(rawText || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\uFFFD/g, ' ')
    .replace(/�/g, ' ')
    .replace(/\u00AD/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\r/g, '')
    .replace(/\s\?(?=[a-zà-ú])/gi, ' ')
    .replace(/\s[?]\s+(?=[a-zà-ú])/gi, ' ')
    .replace(/\s\?\s/g, ' ')
    .replace(/\?\s{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const generateEditorialContent = async ({ title, source, sourceUrl, rawText }) => {
  const cleanRawText = sanitizeRawText(rawText);

  if (!enabled) {
    return {
      content: '',
      mode: 'pending_ai',
      error: 'ai_not_enabled'
    };
  }

  const prompt = [
    'Escreva um post em markdown para portal de noticias em pt-BR.',
    'Obrigatorio manter os headings:',
    '## Resumo em 3 bullets',
    '## Contexto',
    '## Insights e implicacoes',
    '## O que fazer agora',
    '## O que vale acompanhar',
    '## Fonte e transparencia',
    '## Por que isso importa',
    'Sem inventar fatos. Retorne apenas markdown.',
    '',
    `Titulo: ${title}`,
    `Fonte: ${source}`,
    `URL: ${sourceUrl}`,
    `Conteudo bruto: ${cleanRawText.slice(0, 8000)}`
  ].join('\n');

  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: config.openRouterModel,
        messages: [
          { role: 'system', content: 'Voce e um editor de noticias em portugues do Brasil.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: config.openRouterMaxTokens
      },
      {
        timeout: config.requestTimeoutMs,
        headers: {
          Authorization: `Bearer ${config.openRouterKey}`
        }
      }
    );

    const content = response.data?.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('empty_ai_response');

    return {
      content,
      mode: 'ai'
    };
  } catch (err) {
    const status = err?.response?.status;
    const responseMessage = err?.response?.data?.error?.message;
    const errorMessage = responseMessage || err?.message || 'ai_generation_failed';

    return {
      content: '',
      mode: 'pending_ai',
      error: status ? `http_${status}:${errorMessage}` : errorMessage
    };
  }
};

module.exports = {
  generateEditorialContent
};
