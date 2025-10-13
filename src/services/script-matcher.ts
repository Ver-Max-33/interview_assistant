import type { QAPair, MatchResult } from '../types';

export class ScriptMatcher {
  private qaList: QAPair[] = [];
  private embeddings: Map<string, number[]> = new Map();
  
  async initialize(scriptText: string, apiKey: string): Promise<void> {
    this.qaList = this.parseScript(scriptText);
    
    // 各質問のEmbeddingを取得
    for (const qa of this.qaList) {
      try {
        const embedding = await this.getEmbedding(qa.question, apiKey);
        this.embeddings.set(qa.question, embedding);
      } catch (error) {
        console.error('Embeddingの取得に失敗しました:', qa.question, error);
      }
    }
  }
  
  private parseScript(text: string): QAPair[] {
    const qaList: QAPair[] = [];
    
    // パターン1: Q: ... A: ...
    const pattern1 = /Q[:\s：]*(.+?)\n+A[:\s：]*(.+?)(?=\n+Q|\n*$)/gs;
    // パターン2: 質問: ... 回答: ...
    const pattern2 = /質問[:\s：]*(.+?)\n+回答[:\s：]*(.+?)(?=\n+質問|\n*$)/gs;
    // パターン3: 質問？ 改行 回答
    const pattern3 = /(?:^|\n)(.+?[?？])\s*\n+(.+?)(?=\n.+?[?？]|\n*$)/gs;
    
    [pattern1, pattern2, pattern3].forEach(pattern => {
      const matches = [...text.matchAll(pattern)];
      matches.forEach(match => {
        const question = match[1].trim();
        const answer = match[2].trim();
        
        // 重複チェック
        if (!qaList.some(qa => 
          this.normalizeText(qa.question) === this.normalizeText(question)
        )) {
          qaList.push({ question, answer });
        }
      });
    });
    
    return qaList;
  }
  
  async matchQuestion(
    question: string, 
    threshold = 0.85, 
    apiKey: string,
    scriptPriority: 'exact' | 'similar' = 'similar'
  ): Promise<MatchResult> {
    // 1. 完全一致チェック
    for (const qa of this.qaList) {
      if (this.normalizeText(qa.question) === this.normalizeText(question)) {
        return { match: qa, similarity: 1.0, source: 'exact' };
      }
    }
    
    // 2. 類似度チェック（scriptPriorityが'similar'の場合のみ）
    if (scriptPriority === 'similar') {
      try {
        const questionEmbedding = await this.getEmbedding(question, apiKey);
        let bestMatch: QAPair | null = null;
        let bestSimilarity = 0;
        
        for (const qa of this.qaList) {
          const qaEmbedding = this.embeddings.get(qa.question);
          if (!qaEmbedding) continue;
          
          const similarity = this.cosineSimilarity(questionEmbedding, qaEmbedding);
          if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestMatch = qa;
          }
        }
        
        if (bestSimilarity >= threshold && bestMatch) {
          return { match: bestMatch, similarity: bestSimilarity, source: 'similar' };
        }
      } catch (error) {
        console.error('類似度チェックに失敗しました:', error);
      }
    }
    
    return { match: null, similarity: 0, source: 'none' };
  }
  
  private async getEmbedding(text: string, apiKey: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text
      })
    });
    
    if (!response.ok) {
      throw new Error(`Embedding API エラー: ${response.status}`);
    }
    
    const data = await response.json();
    return data.data[0].embedding;
  }
  
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[？。、！?!,\.]/g, '');
  }
  
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }

  getQAList(): QAPair[] {
    return this.qaList;
  }
}

export const scriptMatcher = new ScriptMatcher();

