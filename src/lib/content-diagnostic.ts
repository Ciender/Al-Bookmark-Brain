/**
 * Content Diagnostic Tool
 * 用于诊断 page_content 抓取问题
 * 
 * 在浏览器控制台中运行诊断:
 * 1. 打开扩展的 popup 或 options 页面
 * 2. 在控制台执行: await diagnoseContent()
 */

import { MESSAGE_TYPES } from '../shared/constants';

interface DiagnosticResult {
    totalBookmarks: number;
    withContent: number;
    withoutContent: number;
    contentLengthDistribution: {
        empty: number;      // 0
        tiny: number;       // 1-100
        small: number;      // 101-500
        medium: number;     // 501-2000
        large: number;      // 2001-10000
        huge: number;       // 10000+
    };
    samples: {
        id: number;
        title: string;
        url: string;
        contentLength: number;
        contentPreview: string;
        hasGarbledChars: boolean;
        status: string;
    }[];
    garbledCount: number;
}

/**
 * 检测是否包含乱码字符
 */
function hasGarbledContent(content: string): boolean {
    if (!content) return false;
    
    // 检测常见乱码特征
    const garbledPatterns = [
        /&[a-z]+;/gi,           // 未解码的 HTML 实体 &nbsp; &amp; 等
        /&#\d+;/g,              // 数字 HTML 实体 &#39;
        /\\u[0-9a-f]{4}/gi,     // Unicode 转义
        /\x00/g,                // Null 字符
        /[\uFFFD]/g,            // 替换字符 (乱码标志)
    ];
    
    return garbledPatterns.some(p => p.test(content));
}

/**
 * 发送数据库查询到 offscreen document
 */
async function queryDatabase(sql: string): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.DB_QUERY,
            data: { sql, params: [] }
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else if (response?.success) {
                resolve(response.data || []);
            } else {
                reject(new Error(response?.error || 'Query failed'));
            }
        });
    });
}

/**
 * 运行完整诊断
 */
export async function diagnoseContent(): Promise<DiagnosticResult> {
    console.log('🔍 开始诊断 page_content...');
    
    // 查询所有书签的内容信息
    const rows = await queryDatabase(`
        SELECT 
            id, 
            original_title, 
            url, 
            page_content,
            status,
            LENGTH(page_content) as content_length
        FROM bookmarks
        ORDER BY id DESC
        LIMIT 100
    `) as Array<{
        id: number;
        original_title: string;
        url: string;
        page_content: string | null;
        status: string;
        content_length: number | null;
    }>;
    
    const result: DiagnosticResult = {
        totalBookmarks: rows.length,
        withContent: 0,
        withoutContent: 0,
        contentLengthDistribution: {
            empty: 0,
            tiny: 0,
            small: 0,
            medium: 0,
            large: 0,
            huge: 0,
        },
        samples: [],
        garbledCount: 0,
    };
    
    for (const row of rows) {
        const content = row.page_content || '';
        const length = content.length;
        
        if (length === 0) {
            result.withoutContent++;
            result.contentLengthDistribution.empty++;
        } else {
            result.withContent++;
            
            if (length <= 100) result.contentLengthDistribution.tiny++;
            else if (length <= 500) result.contentLengthDistribution.small++;
            else if (length <= 2000) result.contentLengthDistribution.medium++;
            else if (length <= 10000) result.contentLengthDistribution.large++;
            else result.contentLengthDistribution.huge++;
        }
        
        const hasGarbled = hasGarbledContent(content);
        if (hasGarbled) result.garbledCount++;
        
        // 收集样本 (前 10 个)
        if (result.samples.length < 10) {
            result.samples.push({
                id: row.id,
                title: (row.original_title || '').substring(0, 50),
                url: (row.url || '').substring(0, 80),
                contentLength: length,
                contentPreview: content.substring(0, 200).replace(/\s+/g, ' '),
                hasGarbledChars: hasGarbled,
                status: row.status,
            });
        }
    }
    
    // 打印诊断报告
    console.log('\n📊 诊断结果:');
    console.log('─'.repeat(50));
    console.log(`总书签数: ${result.totalBookmarks}`);
    console.log(`有内容: ${result.withContent} (${(result.withContent/result.totalBookmarks*100).toFixed(1)}%)`);
    console.log(`无内容: ${result.withoutContent} (${(result.withoutContent/result.totalBookmarks*100).toFixed(1)}%)`);
    console.log(`含乱码: ${result.garbledCount}`);
    
    console.log('\n📏 内容长度分布:');
    console.log(`  空白 (0): ${result.contentLengthDistribution.empty}`);
    console.log(`  极短 (1-100): ${result.contentLengthDistribution.tiny}`);
    console.log(`  短 (101-500): ${result.contentLengthDistribution.small}`);
    console.log(`  中 (501-2000): ${result.contentLengthDistribution.medium}`);
    console.log(`  长 (2001-10000): ${result.contentLengthDistribution.large}`);
    console.log(`  超长 (10000+): ${result.contentLengthDistribution.huge}`);
    
    console.log('\n📝 样本数据:');
    result.samples.forEach((s, i) => {
        console.log(`\n[${i+1}] ${s.title}`);
        console.log(`    URL: ${s.url}`);
        console.log(`    状态: ${s.status} | 长度: ${s.contentLength} | 乱码: ${s.hasGarbledChars ? '⚠️ 是' : '✅ 否'}`);
        console.log(`    预览: ${s.contentPreview || '(空)'}`);
    });
    
    console.log('\n─'.repeat(50));
    console.log('💡 诊断完成! 结果对象已返回。');
    
    return result;
}

// 导出到全局，方便控制台调用
if (typeof window !== 'undefined') {
    (window as any).diagnoseContent = diagnoseContent;
}

export default { diagnoseContent };
