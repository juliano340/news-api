const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const countWords = (text) =>
  String(text || '')
    .split(/\s+/)
    .map((v) => v.trim())
    .filter(Boolean).length;

const requiredSections = [
  '## Resumo em 3 bullets',
  '## Contexto',
  '## Insights e implicacoes',
  '## O que fazer agora',
  '## O que vale acompanhar',
  '## Fonte e transparencia',
  '## Por que isso importa'
];

const evaluate = (post) => {
  const content = String(post.content || '');
  const normalizedContent = normalize(content);

  const sectionsOk = requiredSections.every((section) =>
    normalizedContent.includes(normalize(section))
  );

  const summaryBullets = ((content.match(/## Resumo em 3 bullets\n([\s\S]*?)(\n## |$)/) || [])[1] || '').match(/^\s*-\s+/gm)?.length || 0;
  const words = countWords(content);
  const passed = sectionsOk && summaryBullets >= 3 && words >= 180;

  return {
    status: passed ? 'PASS' : 'BLOCK',
    score: passed ? 100 : Math.max(0, (sectionsOk ? 40 : 0) + Math.min(summaryBullets, 3) * 10 + Math.min(words, 180) / 180 * 50),
    checks: [
      { id: 'sections', status: sectionsOk ? 'PASS' : 'FAIL' },
      { id: 'summary_bullets', status: summaryBullets >= 3 ? 'PASS' : 'FAIL', value: summaryBullets },
      { id: 'min_words', status: words >= 180 ? 'PASS' : 'FAIL', value: words }
    ]
  };
};

module.exports = {
  evaluate
};
