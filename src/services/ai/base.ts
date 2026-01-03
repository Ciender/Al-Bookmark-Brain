/**
 * AI Bookmark Brain - AI Service Base v2
 * Base interface and utilities for AI service implementations
 */

import type { SummaryResult, SummarizeRequest } from '../../shared/types';

/**
 * AI Service interface that all providers must implement
 */
export interface AIService {
    readonly provider: string;

    /**
     * Generate summary and tags for a bookmark
     */
    summarize(request: SummarizeRequest): Promise<SummaryResult>;

    /**
     * Test connection to the AI service
     */
    testConnection(): Promise<boolean>;
}

/**
 * Configuration for AI service instances
 */
export interface AIServiceConfig {
    apiKey: string;
    baseUrl?: string;
    model?: string;
}

/**
 * Default prompt template for summarization
 * 支持双语输出的AI总结prompt
 */
export const SUMMARIZE_PROMPT = `# Role
你是一个专注于深度内容分析的技术型AI总结助手。你需要对给定的网页内容进行精准的提取和总结。

# Profile
- **摘要风格**：中等长度，避免过短导致信息丢失，拒绝废话，直击核心技术点。

# Constraints & Workflow

## 1. 语言与输出格式 (Language & Layout)
根据输入内容的原始语言，严格执行以下输出逻辑：
- **情况 A：原始内容仅为中文**
  - summaryZh：输出简体中文摘要
  - summaryOriginal：留空或不输出
  - tagsZh：输出中文Tags
  - tagsOriginal：留空或不输出
- **情况 B：原始内容包含外文（如英文）**
  - summaryZh：输出简体中文翻译后的摘要
  - summaryOriginal：输出外文原文摘要
  - tagsZh：输出中文Tags
  - tagsOriginal：输出外文原文Tags

## 2. 标签生成规则 (Tag Generation Rules) - 核心指令
**必须严格遵守**，你的Tag必须是具体的**实体、型号、参数或具体动作**，严禁使用宽泛的分类词汇。

- **错误示例**：
  - "硬件"、"服务器"、"数码"、"相机"、"拍照"、"极客"、"DIY"、"教程"。
- **正确示例**：
  - 遇到服务器CPU介绍：输出 "LGA 4677"、"Intel"、"8468V"。
  - 遇到镜头评测：输出 "尼康"、"24-70mm F4"、"Z卡口"。
  - 遇到硬件改造：输出 "修改大功率"、"3647"、"BGA转LGA"。
  - 遇到软件开发：输出 "RESTful API"、"MySQL 8.0"、"WebSocket"、"TCP握手"。

# Output Format
返回严格的JSON格式，不要包含任何其他内容：
{
    "summaryZh": "中文摘要内容",
    "summaryOriginal": "外文原文摘要（仅外文内容时填写，中文内容留空字符串）",
    "tagsZh": ["中文标签1", "中文标签2", "中文标签3"],
    "tagsOriginal": ["Tag1", "Tag2", "Tag3"],
    "language": "zh 或 en 或 mixed"
}

# Example (For Foreign Content)
输入为英文服务器CPU评测文章时的输出示例：
{
    "summaryZh": "这是一篇关于Intel第四代至强可扩展处理器的评测，重点介绍了LGA 4677接口的电气特性以及8468V型号在AVX-512负载下的功耗表现。文中详细测试了其与DDR5内存控制器的通讯延迟。",
    "summaryOriginal": "This is a review of the 4th Gen Intel Xeon Scalable Processors, highlighting the electrical characteristics of the LGA 4677 socket and the power consumption of the 8468V model under AVX-512 loads. It details the communication latency with the DDR5 memory controller.",
    "tagsZh": ["LGA 4677", "Intel", "8468V", "AVX-512", "DDR5"],
    "tagsOriginal": ["LGA 4677", "Intel", "8468V", "AVX-512", "DDR5"],
    "language": "en"
}

# Webpage Information to Analyze
Title: {{title}}
URL: {{url}}
{{#if content}}
Content excerpt:
{{content}}
{{/if}}`;

/**
 * Format the summarization prompt
 */
export function formatPrompt(request: SummarizeRequest): string {
    let prompt = SUMMARIZE_PROMPT
        .replace('{{title}}', request.title)
        .replace('{{url}}', request.url);

    if (request.content) {
        // Truncate content to ~3000 chars to stay within token limits
        const truncatedContent = request.content.substring(0, 3000);
        prompt = prompt
            .replace('{{#if content}}', '')
            .replace('{{/if}}', '')
            .replace('{{content}}', truncatedContent);
    } else {
        // Remove content section if not available
        prompt = prompt.replace(/\{\{#if content\}\}[\s\S]*?\{\{\/if\}\}/g, '');
    }

    return prompt;
}

/**
 * Parse AI response to extract bilingual summary and tags
 */
export function parseAIResponse(response: string): SummaryResult {
    try {
        // Remove markdown code block formatting if present
        let cleanResponse = response
            .replace(/^```json\s*/i, '')  // Remove opening ```json
            .replace(/^```\s*/i, '')       // Remove opening ```
            .replace(/\s*```$/i, '')       // Remove closing ```
            .trim();

        // Also handle case where code block is in the middle
        const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (codeBlockMatch) {
            cleanResponse = codeBlockMatch[1].trim();
        }

        // Try to extract JSON from the response
        const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);

            // 解析中文标签（保持原样，不转小写，保留技术术语）
            const tagsZh = Array.isArray(parsed.tagsZh)
                ? parsed.tagsZh.map((t: string) => String(t).trim()).filter(Boolean)
                : Array.isArray(parsed.tags)
                    ? parsed.tags.map((t: string) => String(t).trim()).filter(Boolean)
                    : [];

            // 解析原文标签
            const tagsOriginal = Array.isArray(parsed.tagsOriginal)
                ? parsed.tagsOriginal.map((t: string) => String(t).trim()).filter(Boolean)
                : [];

            return {
                summaryZh: parsed.summaryZh || parsed.summary || '',
                summaryOriginal: parsed.summaryOriginal || undefined,
                tagsZh,
                tagsOriginal: tagsOriginal.length > 0 ? tagsOriginal : undefined,
                confidence: 0.8,
                language: parsed.language || detectLanguage(parsed.summaryZh || parsed.summary || ''),
            };
        }
    } catch (error) {
        // If JSON parsing fails, try to extract text
        console.warn('Failed to parse AI response as JSON:', error);
    }

    // Fallback: treat entire response as Chinese summary, no tags
    return {
        summaryZh: response.trim().substring(0, 500),
        tagsZh: [],
        confidence: 0.5,
        language: detectLanguage(response),
    };
}

/**
 * Simple language detection based on character ranges
 */
function detectLanguage(text: string): string {
    // Check for Chinese characters
    const chineseMatch = text.match(/[\u4e00-\u9fa5]/g);
    if (chineseMatch && chineseMatch.length > text.length * 0.1) {
        return 'zh';
    }
    return 'en';
}

/**
 * Fetch timeout wrapper
 */
export async function fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout = 30000
): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        return response;
    } finally {
        clearTimeout(timeoutId);
    }
}
