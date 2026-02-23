const axios = require('axios');
const config = require('../config');

const enabled = config.useAI && Boolean(config.openRouterKey);

const createMarkdown = ({ title, source, sourceUrl, rawText }) => {
  const base = String(rawText || '').replace(/\s+/g, ' ').trim();
  const excerpt = base.slice(0, 900);

  return [
    `# ${title}`,
    '',
    '## Resumo em 3 bullets',
    '- Fato principal da pauta organizado de forma direta.',
    '- Contexto essencial para entender o impacto no curto prazo.',
    '- Pontos praticos para acompanhar os proximos passos.',
    '',
    '## Contexto',
    excerpt || 'Sem contexto detalhado no momento.',
    '',
    '## Insights e implicacoes',
    'O principal insight e observar como esse movimento afeta decisoes de produto, mercado e comportamento do publico.',
    '',
    '## O que fazer agora',
    '- Validar os fatos em fontes primarias.',
    '- Priorizar impacto de curto prazo para decisao rapida.',
    '- Acompanhar atualizacoes oficiais nos proximos dias.',
    '',
    '## O que vale acompanhar',
    '- Novos desdobramentos oficiais do tema.',
    '- Reacao de mercado e dos principais atores.',
    '- Mudancas praticas que alterem a leitura inicial.',
    '',
    '## Fonte e transparencia',
    `- Fonte primaria: ${sourceUrl || ''}`,
    `- Conteudo coletado automaticamente da fonte ${source || 'desconhecida'}.`,
    '',
    '## Por que isso importa',
    'A pauta ajuda a transformar manchete em decisao pratica com menos ruido e mais contexto.'
  ].join('\n');
};

const generateEditorialContent = async ({ title, source, sourceUrl, rawText }) => {
  if (!enabled) {
    return {
      content: createMarkdown({ title, source, sourceUrl, rawText }),
      mode: 'template'
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
    `Conteudo bruto: ${String(rawText || '').slice(0, 8000)}`
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
        max_tokens: 1400
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
  } catch (_err) {
    return {
      content: createMarkdown({ title, source, sourceUrl, rawText }),
      mode: 'fallback_template'
    };
  }
};

module.exports = {
  generateEditorialContent
};
