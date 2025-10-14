import type { PreparationData } from '../types';

const STOPWORDS = new Set([
  'です',
  'ます',
  'こと',
  'ため',
  'ので',
  'よう',
  'この',
  'その',
  'そして',
  'また',
  'など',
  'これ',
  'それ',
  'もの',
  'ように',
  '経験',
  '担当',
  '業務',
  '対応',
  '使用',
  '実施',
  '個人',
  '会社',
  '企業'
]);

const TOKEN_SPLIT_REGEX = /[\s、，,。．！？?!〜…・\/\\()（）「」『』【】\[\]{}:：;；\-]+/;

export function extractKeywords(preparationData: PreparationData, limit = 25): string[] {
  const corpus = [
    preparationData.resume.text,
    preparationData.careerHistory.text,
    preparationData.interviewScript.text,
    preparationData.position.text,
    preparationData.companyResearch.text,
    preparationData.company,
    preparationData.industry
  ]
    .filter(Boolean)
    .join(' ');

  const frequencyMap = new Map<string, number>();

  corpus
    .split(TOKEN_SPLIT_REGEX)
    .map(token => token.trim())
    .filter(token => token.length >= 2 && token.length <= 20)
    .filter(token => !/^[0-9０-９]+$/.test(token))
    .filter(token => !STOPWORDS.has(token))
    .forEach(token => {
      const count = frequencyMap.get(token) || 0;
      frequencyMap.set(token, count + 1);
    });

  const uniqueKeywords = Array.from(frequencyMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);

  const extra = [
    preparationData.company,
    preparationData.industry,
    preparationData.position.text
  ].filter(Boolean) as string[];

  return Array.from(new Set([...uniqueKeywords, ...extra.map(item => item.trim())].filter(Boolean)));
}
