import type { Message, PreparationData, QAPair } from '../types';

const DEFAULT_MAX_TOTAL_CHARS = 9000;
const DEFAULT_CONVERSATION_TURNS = 6;
const DEFAULT_RECENT_MEMORY = 4;

const TOKEN_SPLIT_REGEX =
  /[\s、，,。．！？?!〜…・\/\\()（）「」『』【】\[\]{}:：;；\-—_"'“”‘’]+/;

const STOP_WORDS = new Set([
  'です',
  'ます',
  'する',
  'して',
  'した',
  'こと',
  'よう',
  'ため',
  'これ',
  'それ',
  'その',
  'この',
  'に',
  'と',
  'は',
  'が',
  'を',
  'で',
  'な',
  'の',
  'へ',
  'から',
  'まで',
  'また',
  'など',
  'そして',
  'ですが',
  'ので',
  'より',
  'さらに',
  'まず',
  'ますが',
  'ますので'
]);

type ChunkType =
  | 'profile'
  | 'resume'
  | 'career_history'
  | 'interview_script'
  | 'position'
  | 'company_research'
  | 'custom';

interface ContextChunk {
  id: string;
  type: ChunkType;
  title: string;
  content: string;
  basePriority: number;
  keywords: string[];
  questionTokens?: string[];
  alwaysInclude?: boolean;
}

interface ContextManagerOptions {
  maxTotalCharacters?: number;
  conversationTurnLimit?: number;
  recentChunkMemory?: number;
}

interface BuildSnapshotInput {
  question: string;
  conversation: Message[];
}

interface BuildSnapshotResult {
  context: string;
  usedChunkIds: string[];
  totalChars: number;
  truncated: boolean;
}

interface SerializedChunk {
  id: string;
  type: ChunkType;
  title: string;
  content?: string;
  question?: string;
  answer?: string;
}

interface SnapshotPayload {
  context_version: number;
  pending_question: string;
  conversation_window: Array<{
    speaker: Message['speaker'];
    text: string;
    timestamp: string;
  }>;
  knowledge_chunks: SerializedChunk[];
}

export class ContextManager {
  private options: Required<ContextManagerOptions>;
  private chunks: ContextChunk[] = [];
  private recentChunkIds: string[] = [];

  constructor(options?: ContextManagerOptions) {
    this.options = {
      maxTotalCharacters: options?.maxTotalCharacters ?? DEFAULT_MAX_TOTAL_CHARS,
      conversationTurnLimit:
        options?.conversationTurnLimit ?? DEFAULT_CONVERSATION_TURNS,
      recentChunkMemory: options?.recentChunkMemory ?? DEFAULT_RECENT_MEMORY
    };
  }

  updateOptions(options: ContextManagerOptions): void {
    this.options = {
      maxTotalCharacters:
        options.maxTotalCharacters ?? this.options.maxTotalCharacters,
      conversationTurnLimit:
        options.conversationTurnLimit ?? this.options.conversationTurnLimit,
      recentChunkMemory:
        options.recentChunkMemory ?? this.options.recentChunkMemory
    };
  }

  initialize(data: PreparationData): void {
    this.chunks = [];
    this.recentChunkIds = [];
    this.ingestPreparationData(data);
  }

  setScriptChunks(list: QAPair[]): void {
    this.chunks = this.chunks.filter(
      chunk => chunk.type !== 'interview_script'
    );

    list.forEach((qa, index) => {
      const baseId = `interview_script-${index + 1}`;
      const question = qa.question.trim();
      const answer = qa.answer.trim();
      const serialized = `Q: ${question}\nA: ${answer}`;
      const questionTokens = this.tokenize(question);

      this.chunks.push({
        id: baseId,
        type: 'interview_script',
        title: question,
        content: serialized,
        basePriority: 1.5,
        keywords: this.deriveKeywords(`${question} ${answer}`),
        questionTokens,
        alwaysInclude: false
      });
    });
  }

  buildSnapshot(input: BuildSnapshotInput): BuildSnapshotResult {
    const normalizedQuestion = input.question?.trim() ?? '';
    const questionTokens = new Set(this.tokenize(normalizedQuestion));
    const conversationWindow = this.buildConversationWindow(input.conversation);
    const conversationTokens = new Set(
      conversationWindow.flatMap(entry => this.tokenize(entry.text))
    );
    const combinedTokens = new Set<string>([
      ...questionTokens,
      ...conversationTokens
    ]);

    const alwaysIncludeChunks = this.chunks.filter(
      chunk => chunk.alwaysInclude
    );

    const scored = this.chunks
      .map(chunk => ({
        chunk,
        score: this.scoreChunk(chunk, combinedTokens, questionTokens)
      }))
      .sort((a, b) => b.score - a.score);

    const selected: ContextChunk[] = [];
    const selectedIds = new Set<string>();

    alwaysIncludeChunks.forEach(chunk => {
      if (!selectedIds.has(chunk.id)) {
        selected.push(chunk);
        selectedIds.add(chunk.id);
      }
    });

    let snapshotString = this.serializeSnapshot(
      normalizedQuestion,
      conversationWindow,
      selected
    );
    let truncated = false;

    for (const entry of scored) {
      if (selectedIds.has(entry.chunk.id)) {
        continue;
      }

      const tentative = [...selected, entry.chunk];
      const tentativeString = this.serializeSnapshot(
        normalizedQuestion,
        conversationWindow,
        tentative
      );

      if (
        tentativeString.length <= this.options.maxTotalCharacters ||
        selected.length === 0
      ) {
        selected.push(entry.chunk);
        selectedIds.add(entry.chunk.id);
        snapshotString = tentativeString;
      } else {
        truncated = true;
      }
    }

    if (snapshotString.length > this.options.maxTotalCharacters) {
      truncated = true;
      while (
        snapshotString.length > this.options.maxTotalCharacters &&
        selected.length > 1
      ) {
        selected.pop();
        snapshotString = this.serializeSnapshot(
          normalizedQuestion,
          conversationWindow,
          selected
        );
      }
    }

    this.updateRecentChunks(selected.map(chunk => chunk.id));

    return {
      context: snapshotString,
      usedChunkIds: selected.map(chunk => chunk.id),
      totalChars: snapshotString.length,
      truncated
    };
  }

  private ingestPreparationData(data: PreparationData): void {
    this.chunks.push({
      id: 'profile-summary',
      type: 'profile',
      title: '応募者基本情報',
      content: JSON.stringify(
        {
          industry: data.industry,
          company: data.company,
          position: data.position.text,
          voiceCalibrated: data.voiceCalibrated
        },
        null,
        2
      ),
      basePriority: 1.2,
      keywords: this.deriveKeywords(
        `${data.industry} ${data.company} ${data.position.text}`
      ),
      alwaysInclude: true
    });

    if (data.resume.type !== 'none') {
      this.ingestDocument({
        idPrefix: 'resume',
        type: 'resume',
        title: '履歴書',
        rawText: data.resume.text,
        fallbackNote:
          data.resume.type === 'file' && data.resume.file
            ? `PDF ${data.resume.file.name} のテキストが取得できませんでした`
            : undefined,
        basePriority: 0.9
      });
    }

    if (data.careerHistory.type !== 'none') {
      this.ingestDocument({
        idPrefix: 'career',
        type: 'career_history',
        title: '職務経歴書',
        rawText: data.careerHistory.text,
        fallbackNote:
          data.careerHistory.type === 'file' && data.careerHistory.file
            ? `PDF ${data.careerHistory.file.name} のテキストが取得できませんでした`
            : undefined,
        basePriority: 1.0
      });
    }

    if (data.position.type !== 'none') {
      this.ingestDocument({
        idPrefix: 'position',
        type: 'position',
        title: '募集職種・ポジション',
        rawText: data.position.text,
        fallbackNote:
          data.position.type === 'file' && data.position.file
            ? `PDF ${data.position.file.name} のテキストが取得できませんでした`
            : undefined,
        basePriority: 0.8
      });
    }

    if (
      data.companyResearch.type !== 'none' &&
      (data.companyResearch.text ||
        (data.companyResearch.file && data.companyResearch.type === 'file'))
    ) {
      this.ingestDocument({
        idPrefix: 'company-research',
        type: 'company_research',
        title: '企業研究メモ',
        rawText: data.companyResearch.text,
        fallbackNote:
          data.companyResearch.type === 'file' && data.companyResearch.file
            ? `PDF ${data.companyResearch.file.name} のテキストが取得できませんでした`
            : undefined,
        basePriority: 0.7
      });
    }
  }

  private ingestDocument(params: {
    idPrefix: string;
    type: ChunkType;
    title: string;
    rawText?: string;
    fallbackNote?: string;
    basePriority: number;
  }): void {
    const text = params.rawText?.trim();

    if (text && text.length > 0) {
      const segments = this.splitIntoSegments(text);
      segments.forEach((segment, index) => {
        this.chunks.push({
          id: `${params.idPrefix}-${index + 1}`,
          type: params.type,
          title:
            segments.length > 1
              ? `${params.title} #${index + 1}`
              : params.title,
          content: segment,
          basePriority: params.basePriority,
          keywords: this.deriveKeywords(segment)
        });
      });
      return;
    }

    if (params.fallbackNote) {
      this.chunks.push({
        id: `${params.idPrefix}-fallback`,
        type: params.type,
        title: params.title,
        content: params.fallbackNote,
        basePriority: params.basePriority * 0.6,
        keywords: this.deriveKeywords(params.fallbackNote)
      });
    }
  }

  private splitIntoSegments(text: string, maxLength = 700): string[] {
    const paragraphs = text
      .split(/\n{2,}/)
      .map(item => item.trim())
      .filter(Boolean);

    if (paragraphs.length === 0) {
      return [text.slice(0, maxLength)];
    }

    const segments: string[] = [];
    let buffer = '';

    const flushBuffer = () => {
      if (buffer.trim().length > 0) {
        segments.push(buffer.trim());
      }
      buffer = '';
    };

    paragraphs.forEach(paragraph => {
      const candidate = buffer.length
        ? `${buffer}\n\n${paragraph}`
        : paragraph;
      if (candidate.length <= maxLength) {
        buffer = candidate;
      } else {
        flushBuffer();
        if (paragraph.length > maxLength) {
          for (let i = 0; i < paragraph.length; i += maxLength) {
            segments.push(paragraph.slice(i, i + maxLength));
          }
        } else {
          buffer = paragraph;
        }
      }
    });

    flushBuffer();

    return segments;
  }

  private tokenize(text: string): string[] {
    if (!text) {
      return [];
    }
    return text
      .toLowerCase()
      .split(TOKEN_SPLIT_REGEX)
      .map(token => token.trim())
      .filter(token => token.length >= 2 && !STOP_WORDS.has(token));
  }

  private deriveKeywords(text: string): string[] {
    const tokens = this.tokenize(text);
    const counts = new Map<string, number>();

    tokens.forEach(token => {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    });

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(entry => entry[0]);
  }

  private scoreChunk(
    chunk: ContextChunk,
    combinedTokens: Set<string>,
    questionTokens: Set<string>
  ): number {
    let score = chunk.basePriority;
    let keywordMatches = 0;

    chunk.keywords.forEach(keyword => {
      if (combinedTokens.has(keyword)) {
        keywordMatches += 1;
      }
    });

    if (keywordMatches > 0) {
      score += keywordMatches * 0.6;
    }

    if (chunk.type === 'interview_script' && chunk.questionTokens) {
      let questionMatches = 0;
      chunk.questionTokens.forEach(token => {
        if (questionTokens.has(token)) {
          questionMatches += 1;
        }
      });

      if (questionMatches > 0) {
        score += questionMatches * 1.2;
        const coverage =
          questionMatches / Math.max(chunk.questionTokens.length, 1);
        if (coverage >= 0.5) {
          score += 2.0;
        }
      }
    }

    if (this.recentChunkIds.includes(chunk.id)) {
      score += 0.5;
    }

    return score;
  }

  private buildConversationWindow(conversation: Message[]) {
    const finalMessages = conversation.filter(item => item.isFinal);
    return finalMessages
      .slice(-this.options.conversationTurnLimit)
      .map(item => ({
        speaker: item.speaker,
        text: item.text,
        timestamp: item.timestamp
      }));
  }

  private serializeSnapshot(
    question: string,
    conversationWindow: SnapshotPayload['conversation_window'],
    chunks: ContextChunk[]
  ): string {
    const payload: SnapshotPayload = {
      context_version: 1,
      pending_question: question,
      conversation_window: conversationWindow,
      knowledge_chunks: chunks.map(chunk => this.serializeChunk(chunk))
    };

    return JSON.stringify(payload, null, 2);
  }

  private serializeChunk(chunk: ContextChunk): SerializedChunk {
    if (chunk.type === 'interview_script') {
      const [questionLine, ...rest] = chunk.content.split('\n');
      const answerText = rest.join('\n').replace(/^A:\s*/, '').trim();
      const questionText = questionLine.replace(/^Q:\s*/, '').trim();

      return {
        id: chunk.id,
        type: chunk.type,
        title: chunk.title,
        question: questionText,
        answer: answerText
      };
    }

    return {
      id: chunk.id,
      type: chunk.type,
      title: chunk.title,
      content: chunk.content
    };
  }

  private updateRecentChunks(currentIds: string[]): void {
    this.recentChunkIds = currentIds
      .concat(this.recentChunkIds)
      .filter((id, index, arr) => arr.indexOf(id) === index)
      .slice(0, this.options.recentChunkMemory);
  }
}

export function createContextManager(options?: ContextManagerOptions) {
  return new ContextManager(options);
}
