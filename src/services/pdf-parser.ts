/**
 * PDF解析服务
 * 使用pdfjs-dist提取PDF文件中的文本内容
 */

import * as pdfjsLib from 'pdfjs-dist';

// 设置worker路径（使用npm包内的worker）
// 直接使用pdfjs-dist包中的worker文件
const workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

console.log('✅ PDF.js初期化完了, version:', pdfjsLib.version);
console.log('📦 Worker path:', workerSrc);

/**
 * 从PDF文件中提取文本
 * @param file PDF文件对象
 * @returns 提取的文本内容
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  try {
    console.log('📄 開始PDF解析:', file.name);
    
    // 将文件读取为ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    
    // 加载PDF文档
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    console.log(`📖 PDF页数: ${pdf.numPages}`);
    
    // 提取所有页面的文本
    const textPromises: Promise<string>[] = [];
    
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      textPromises.push(
        (async () => {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(' ');
          console.log(`📄 第${pageNum}ページ: ${pageText.length}文字`);
          return pageText;
        })()
      );
    }
    
    const pageTexts = await Promise.all(textPromises);
    const fullText = pageTexts.join('\n\n');
    
    console.log(`✅ PDF解析完了: 合計${fullText.length}文字`);
    
    return fullText.trim();
    
  } catch (err: any) {
    console.error('❌ PDF解析エラー:', err);
    throw new Error(`PDFファイルの解析に失敗しました: ${err.message || 'Unknown error'}`);
  }
}

