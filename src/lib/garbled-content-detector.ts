/**
 * Garbled Content Detector (乱码检测器)
 * 
 * Detects mojibake (garbled text) in page_content that needs refetching.
 * Focuses on common patterns from GBK/GB2312 ↔ UTF-8 misinterpretation.
 */

import { logger } from '../shared/logger';

/**
 * 检测结果类型
 */
export interface GarbledDetectionResult {
    isGarbled: boolean;
    isEmpty: boolean;
    needsRefetch: boolean;
    reason?: string;
    score: number; // 0-100, higher = more likely garbled
}

/**
 * 常见的未解码 HTML 实体
 * 这些通常表示内容没有正确处理
 */
const HTML_ENTITY_PATTERNS = [
    /&nbsp;/gi,
    /&amp;/gi,
    /&lt;/gi,
    /&gt;/gi,
    /&quot;/gi,
    /&#\d+;/g,        // 数字实体 &#39; &#160;
    /&#x[0-9a-f]+;/gi, // 十六进制实体 &#xA0;
];

/**
 * GBK/GB2312 误解为 UTF-8 时产生的典型乱码字符模式
 * 这些模式在正常中文文本中极少出现
 */
const MOJIBAKE_CHAR_PATTERNS = [
    // 常见的 GBK→UTF-8 误解码产物
    /[֧ύͶ]/g,           // 希腊/希伯来字符（例子中出现）
    /[æçèéêëìíîïðñòóôõö÷øùúûüýþÿ]{2,}/gi, // 连续 Latin-1 扩展字符
    /[ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞ]{2,}/g, // 连续大写 Latin-1
    /[\u0100-\u017F]{3,}/g, // Latin Extended-A 连续出现
    /[\u0180-\u024F]{3,}/g, // Latin Extended-B 连续出现
    /[\u0370-\u03FF]{2,}/g, // 希腊字符连续出现（非希腊网站）
    /[\u0400-\u04FF]{3,}/g, // 西里尔字符连续出现（非俄语网站）
];

/**
 * Unicode 替换字符 - 编码失败的明确标志
 */
const REPLACEMENT_CHAR = '\uFFFD';
const REPLACEMENT_CHAR_PATTERN = /\uFFFD/g;

/**
 * 乱码特征：常见的问号替代模式
 */
const QUESTION_MARK_PATTERN = /\?{3,}/g; // 连续3个以上问号

/**
 * 检测内容是否为乱码
 * 
 * @param content - 待检测的内容
 * @returns 检测结果，包含是否乱码及置信度评分
 */
export function detectGarbledContent(content: string): GarbledDetectionResult {
    // 空内容检测
    if (!content || content.trim().length === 0) {
        return {
            isGarbled: false,
            isEmpty: true,
            needsRefetch: true,
            reason: '内容为空',
            score: 0,
        };
    }

    const trimmedContent = content.trim();
    const contentLength = trimmedContent.length;

    // 内容太短，可能是抓取失败
    if (contentLength < 50) {
        return {
            isGarbled: false,
            isEmpty: false,
            needsRefetch: true,
            reason: '内容过短',
            score: 0,
        };
    }

    // 检测frameset页面未正确抓取（"This page uses frames"回退内容）
    const lowerContent = trimmedContent.toLowerCase();
    if (
        lowerContent.includes('this page uses frames') ||
        lowerContent.includes('your browser doesn\'t support') ||
        lowerContent.includes('your browser does not support frames')
    ) {
        return {
            isGarbled: true,
            isEmpty: false,
            needsRefetch: true,
            reason: 'Frameset页面内容未正确抓取',
            score: 100,
        };
    }


    let score = 0;
    const reasons: string[] = [];

    // 1. 检测 Unicode 替换字符 (最强信号)
    const replacementCount = (trimmedContent.match(REPLACEMENT_CHAR_PATTERN) || []).length;
    if (replacementCount > 0) {
        const ratio = replacementCount / contentLength;
        if (ratio > 0.01) { // 超过 1% 是替换字符
            score += 50;
            reasons.push(`Unicode替换字符(${replacementCount}个)`);
        } else if (replacementCount > 3) {
            score += 30;
            reasons.push(`Unicode替换字符(${replacementCount}个)`);
        }
    }

    // 2. 检测未解码的 HTML 实体
    let htmlEntityCount = 0;
    for (const pattern of HTML_ENTITY_PATTERNS) {
        const matches = trimmedContent.match(pattern);
        if (matches) {
            htmlEntityCount += matches.length;
        }
    }
    if (htmlEntityCount > 5) {
        score += 40;
        reasons.push(`HTML实体未解码(${htmlEntityCount}个)`);
    } else if (htmlEntityCount > 2) {
        score += 20;
        reasons.push(`HTML实体未解码(${htmlEntityCount}个)`);
    }

    // 3. 检测典型乱码字符模式
    let mojibakeMatches = 0;
    for (const pattern of MOJIBAKE_CHAR_PATTERNS) {
        const matches = trimmedContent.match(pattern);
        if (matches) {
            mojibakeMatches += matches.length;
        }
    }
    if (mojibakeMatches > 10) {
        score += 40;
        reasons.push(`乱码字符模式(${mojibakeMatches}处)`);
    } else if (mojibakeMatches > 3) {
        score += 25;
        reasons.push(`乱码字符模式(${mojibakeMatches}处)`);
    }

    // 4. 检测连续问号（常见的编码失败替代）
    const questionMarks = trimmedContent.match(QUESTION_MARK_PATTERN);
    if (questionMarks && questionMarks.length > 2) {
        score += 20;
        reasons.push(`连续问号(${questionMarks.length}处)`);
    }

    // 5. CJK 字符比例检测（针对预期中文内容）
    // 如果内容包含部分中文但 CJK 比例异常低，可能是乱码
    const cjkPattern = /[\u4e00-\u9fff\u3400-\u4dbf]/g;
    const cjkMatches = trimmedContent.match(cjkPattern);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;
    const cjkRatio = cjkCount / contentLength;

    // 如果有一些中文但比例很低（< 5%），且有其他乱码信号
    if (cjkCount > 0 && cjkCount < 20 && cjkRatio < 0.05 && score > 0) {
        score += 15;
        reasons.push(`CJK字符比例异常低(${(cjkRatio * 100).toFixed(1)}%)`);
    }

    // 判定结果
    const isGarbled = score >= 40;

    return {
        isGarbled,
        isEmpty: false,
        needsRefetch: isGarbled,
        reason: reasons.length > 0 ? reasons.join(', ') : undefined,
        score,
    };
}

/**
 * 简化版检测：判断内容是否需要重新抓取
 * 
 * @param content - 待检测的内容
 * @returns true 表示需要重新抓取
 */
export function needsRefetch(content: string | null | undefined): boolean {
    if (!content) return true;
    const result = detectGarbledContent(content);
    return result.needsRefetch;
}

/**
 * 检测指定样本内容，返回详细诊断信息
 * 用于调试和日志输出
 */
export function diagnoseContent(content: string): string {
    const result = detectGarbledContent(content);

    const lines = [
        `=== 内容诊断 ===`,
        `长度: ${content.length}`,
        `评分: ${result.score}/100`,
        `是否乱码: ${result.isGarbled ? '是' : '否'}`,
        `是否为空: ${result.isEmpty ? '是' : '否'}`,
        `需要重抓: ${result.needsRefetch ? '是' : '否'}`,
    ];

    if (result.reason) {
        lines.push(`原因: ${result.reason}`);
    }

    // 显示前 100 字符预览
    const preview = content.substring(0, 100).replace(/\s+/g, ' ');
    lines.push(`预览: ${preview}...`);

    return lines.join('\n');
}

/**
 * 批量检测多条内容
 */
export function batchDetect(contents: Array<{ id: number; content: string | null }>): Array<{
    id: number;
    result: GarbledDetectionResult;
}> {
    return contents.map(({ id, content }) => ({
        id,
        result: content ? detectGarbledContent(content) : {
            isGarbled: false,
            isEmpty: true,
            needsRefetch: true,
            reason: '内容为空',
            score: 0,
        },
    }));
}

// 导出工具函数到全局（方便控制台调试）
if (typeof window !== 'undefined') {
    (window as any).detectGarbledContent = detectGarbledContent;
    (window as any).diagnoseGarbledContent = diagnoseContent;
}

export default {
    detectGarbledContent,
    needsRefetch,
    diagnoseContent,
    batchDetect,
};
