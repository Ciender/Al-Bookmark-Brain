/**
 * AI Bookmark Brain - Database Schema v2
 * 重新设计的数据库架构，支持多语言搜索、模糊匹配、权重优先级
 */

import { DB_VERSION } from '../shared/constants';

export const SCHEMA_VERSION = DB_VERSION;

/**
 * 完整的表创建SQL
 */
export const CREATE_TABLES_SQL = `
-- =====================================================
-- 1. bookmarks - 核心书签表
-- =====================================================
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Chrome相关
  chrome_bookmark_id TEXT,
  chrome_folder_path TEXT,
  
  -- 基本信息
  url TEXT NOT NULL UNIQUE,
  original_title TEXT NOT NULL,
  favicon_url TEXT,
  
  -- 页面内容 (无长度限制)
  page_content TEXT,
  page_content_hash TEXT,  -- 用于去重检测
  
  -- 用户自定义
  user_notes TEXT,         -- 用户笔记
  user_category_id INTEGER,-- 用户手动分类 (FK to categories)
  
  -- 处理状态
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/analyzing/completed/failed
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  
  -- 抓取失败标记 (用于跳过失效网站)
  fetch_failed_at INTEGER,       -- 抓取失败时间戳 (非空表示该网站失效)
  fetch_fail_reason TEXT,        -- 失败原因
  
  -- 标记
  is_archived INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0,
  visit_count INTEGER DEFAULT 0,
  
  -- 时间戳
  created_at INTEGER NOT NULL,
  analyzed_at INTEGER,      -- AI分析完成时间
  content_fetched_at INTEGER,
  last_updated INTEGER NOT NULL,
  
  FOREIGN KEY (user_category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_bookmarks_url ON bookmarks(url);
CREATE INDEX IF NOT EXISTS idx_bookmarks_title ON bookmarks(original_title);
CREATE INDEX IF NOT EXISTS idx_bookmarks_status ON bookmarks(status);
CREATE INDEX IF NOT EXISTS idx_bookmarks_created ON bookmarks(created_at);
CREATE INDEX IF NOT EXISTS idx_bookmarks_chrome_id ON bookmarks(chrome_bookmark_id);

-- =====================================================
-- 2. ai_summaries - AI生成的摘要
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bookmark_id INTEGER NOT NULL UNIQUE,
  
  -- AI信息
  ai_provider TEXT NOT NULL,  -- deepseek/gemini/openai
  ai_model TEXT,              -- 具体模型名
  
  -- 生成内容
  summary_text TEXT NOT NULL, -- 中文摘要 (主要搜索目标)
  summary_text_lower TEXT,    -- 小写版本 (用于大小写不敏感搜索)
  summary_original TEXT,      -- 原文摘要 (外文内容时有值)
  
  -- 质量评估
  confidence_score REAL,      -- 0-1 置信度
  language TEXT,              -- 检测到的语言 zh/en/mixed
  
  -- 时间
  created_at INTEGER NOT NULL,
  
  FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_summaries_bookmark ON ai_summaries(bookmark_id);

-- =====================================================
-- 3. tags - AI生成的标签 (类似分类但由AI自动生成)
-- =====================================================
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- 标签名 (多形式存储支持多语言搜索)
  name TEXT NOT NULL UNIQUE,      -- 规范化名称 (小写)
  name_zh TEXT,                   -- 中文名
  name_en TEXT,                   -- 英文名
  name_pinyin TEXT,               -- 拼音 (用于拼音搜索)
  
  -- 来源
  source TEXT NOT NULL DEFAULT 'ai',  -- ai/user
  
  -- 统计
  usage_count INTEGER DEFAULT 0,
  
  -- 显示
  color TEXT DEFAULT '#808080',
  
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
CREATE INDEX IF NOT EXISTS idx_tags_name_pinyin ON tags(name_pinyin);
CREATE INDEX IF NOT EXISTS idx_tags_name_zh ON tags(name_zh);
CREATE INDEX IF NOT EXISTS idx_tags_name_en ON tags(name_en);

-- =====================================================
-- 4. bookmark_tags - 书签-标签关联 (多对多)
-- =====================================================
CREATE TABLE IF NOT EXISTS bookmark_tags (
  bookmark_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  
  -- 元数据
  source TEXT NOT NULL DEFAULT 'ai',  -- ai/user (谁打的标签)
  confidence REAL,                     -- AI置信度
  created_at INTEGER NOT NULL,
  
  PRIMARY KEY (bookmark_id, tag_id),
  FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- =====================================================
-- 5. categories - 用户手动分类
-- =====================================================
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  name TEXT NOT NULL UNIQUE,
  name_pinyin TEXT,           -- 拼音 (用于拼音搜索)
  
  -- 显示
  icon TEXT,                  -- emoji或图标名
  color TEXT DEFAULT '#808080',
  
  -- 层级
  parent_id INTEGER,
  sort_order INTEGER DEFAULT 0,
  
  created_at INTEGER NOT NULL,
  
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);
CREATE INDEX IF NOT EXISTS idx_categories_pinyin ON categories(name_pinyin);

-- =====================================================
-- 6. embeddings - 向量嵌入 (预留接口)
-- =====================================================
CREATE TABLE IF NOT EXISTS embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bookmark_id INTEGER NOT NULL,
  
  -- 模型信息
  model_name TEXT NOT NULL,   -- 嵌入模型名称
  model_version TEXT,
  
  -- 向量数据
  vector BLOB NOT NULL,       -- 序列化的浮点数组
  dimension INTEGER NOT NULL, -- 向量维度
  
  created_at INTEGER NOT NULL,
  
  FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_embeddings_bookmark ON embeddings(bookmark_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model_name);

-- =====================================================
-- 7. search_history - 搜索历史
-- =====================================================
CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  query TEXT NOT NULL,            -- 搜索词
  query_lower TEXT NOT NULL,      -- 小写版本
  
  -- 搜索类型
  search_type TEXT DEFAULT 'default',  -- default/fulltext/tag/category
  
  -- 结果统计
  result_count INTEGER DEFAULT 0,
  selected_bookmark_id INTEGER,   -- 用户点击的结果
  
  -- 时间
  searched_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_query ON search_history(query_lower);
CREATE INDEX IF NOT EXISTS idx_search_time ON search_history(searched_at);

-- =====================================================
-- 8. sync_log - 同步日志
-- =====================================================
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  action TEXT NOT NULL,       -- add/update/delete/analyze/fetch_content
  bookmark_id INTEGER,
  
  status TEXT NOT NULL,       -- pending/success/failed
  message TEXT,
  
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_log_time ON sync_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_sync_log_status ON sync_log(status);

-- =====================================================
-- 9. history_records - 浏览历史记录 (用于 ! 搜索)
-- =====================================================
CREATE TABLE IF NOT EXISTS history_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- 核心内容 (可搜索)
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,         -- UNIQUE for upsert
  
  -- 页面预览
  page_description TEXT,            -- meta description
  favicon_url TEXT,
  
  -- 来源追踪
  source_type TEXT NOT NULL DEFAULT 'navigate',  -- 'search'|'navigate'|'bookmark'
  search_query TEXT,                -- 如果来自搜索记录
  bookmark_id INTEGER,              -- 关联书签ID (如果有)
  
  -- Frecency 数据
  visit_count INTEGER DEFAULT 1,
  total_time_spent INTEGER DEFAULT 0,   -- 总停留时间 (ms)
  
  -- 时间戳
  first_visit_at INTEGER NOT NULL,
  last_visit_at INTEGER NOT NULL,
  
  FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_history_title ON history_records(title);
CREATE INDEX IF NOT EXISTS idx_history_url ON history_records(url);
CREATE INDEX IF NOT EXISTS idx_history_visit ON history_records(last_visit_at DESC);

-- =====================================================
-- 10. schema_version - 版本控制
-- =====================================================
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

INSERT OR IGNORE INTO schema_version (version) VALUES (${SCHEMA_VERSION});
`;

/**
 * 搜索权重配置
 * 用于混合模糊搜索和精确搜索
 */
export const SEARCH_WEIGHTS = {
  // 精确匹配 (大小写完全一致)
  EXACT_CASE_MATCH: 100,

  // 精确匹配 (大小写不敏感)
  EXACT_MATCH: 90,

  // 字段权重
  URL: 85,
  TITLE: 80,
  AI_SUMMARY: 75,
  TAGS: 70,
  USER_CATEGORY: 65,
  USER_NOTES: 60,
  PAGE_CONTENT: 50,  // 全文搜索时使用

  // 模糊匹配权重
  FUZZY: 40,
  PINYIN: 35,
} as const;

/**
 * SQL查询模板
 */
export const QUERIES = {
  // ========== Bookmark CRUD ==========
  INSERT_BOOKMARK: `
    INSERT INTO bookmarks (
      chrome_bookmark_id, chrome_folder_path, url, original_title, 
      favicon_url, status, created_at, last_updated
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `,

  UPDATE_BOOKMARK: `
    UPDATE bookmarks SET
      original_title = ?, url = ?, favicon_url = ?,
      chrome_folder_path = ?, last_updated = ?
    WHERE chrome_bookmark_id = ?
  `,

  UPDATE_BOOKMARK_CONTENT: `
    UPDATE bookmarks SET
      page_content = ?, page_content_hash = ?,
      content_fetched_at = ?, last_updated = ?
    WHERE id = ?
  `,

  UPDATE_BOOKMARK_STATUS: `
    UPDATE bookmarks SET
      status = ?, error_message = ?, analyzed_at = ?, last_updated = ?
    WHERE id = ?
  `,

  DELETE_BOOKMARK: `
    DELETE FROM bookmarks WHERE chrome_bookmark_id = ?
  `,

  GET_BOOKMARK_BY_CHROME_ID: `
    SELECT * FROM bookmarks WHERE chrome_bookmark_id = ?
  `,

  GET_BOOKMARK_BY_ID: `
    SELECT * FROM bookmarks WHERE id = ?
  `,

  GET_BOOKMARKS_PENDING: `
    SELECT * FROM bookmarks 
    WHERE status = 'pending' OR (status = 'failed' AND retry_count < 3)
    ORDER BY created_at ASC
    LIMIT ?
  `,

  // ========== 搜索查询 ==========

  // 默认搜索 (标题 + AI摘要 + 标签 + 用户分类)
  SEARCH_DEFAULT: `
    SELECT DISTINCT b.*, s.summary_text, s.ai_provider,
      GROUP_CONCAT(DISTINCT t.name) as tag_names,
      c.name as category_name
    FROM bookmarks b
    LEFT JOIN ai_summaries s ON b.id = s.bookmark_id
    LEFT JOIN bookmark_tags bt ON b.id = bt.bookmark_id
    LEFT JOIN tags t ON bt.tag_id = t.id
    LEFT JOIN categories c ON b.user_category_id = c.id
    WHERE 
      b.original_title LIKE ? OR
      LOWER(b.original_title) LIKE LOWER(?) OR
      s.summary_text LIKE ? OR
      s.summary_text_lower LIKE LOWER(?) OR
      t.name LIKE ? OR
      t.name_pinyin LIKE ? OR
      t.name_zh LIKE ? OR
      t.name_en LIKE ? OR
      c.name LIKE ? OR
      c.name_pinyin LIKE ? OR
      b.user_notes LIKE ?
    GROUP BY b.id
    ORDER BY b.is_pinned DESC, b.last_updated DESC
    LIMIT ?
  `,

  // 全文搜索 (包含page_content)
  SEARCH_FULLTEXT: `
    SELECT DISTINCT b.*, s.summary_text, s.ai_provider
    FROM bookmarks b
    LEFT JOIN ai_summaries s ON b.id = s.bookmark_id
    WHERE 
      b.original_title LIKE ? OR
      b.url LIKE ? OR
      b.page_content LIKE ? OR
      s.summary_text LIKE ? OR
      b.user_notes LIKE ?
    ORDER BY b.is_pinned DESC, b.last_updated DESC
    LIMIT ?
  `,

  // ========== AI Summary ==========
  INSERT_SUMMARY: `
    INSERT INTO ai_summaries (
      bookmark_id, ai_provider, ai_model, summary_text, 
      summary_text_lower, summary_original, confidence_score, language, created_at
    ) VALUES (?, ?, ?, ?, LOWER(?), ?, ?, ?, ?)
  `,

  GET_SUMMARY_BY_BOOKMARK: `
    SELECT * FROM ai_summaries WHERE bookmark_id = ?
  `,

  // ========== Tags ==========
  INSERT_TAG: `
    INSERT OR IGNORE INTO tags (
      name, name_zh, name_en, name_pinyin, source, created_at
    ) VALUES (LOWER(?), ?, ?, ?, ?, ?)
  `,

  GET_TAG_BY_NAME: `
    SELECT * FROM tags WHERE name = LOWER(?)
  `,

  ADD_BOOKMARK_TAG: `
    INSERT OR IGNORE INTO bookmark_tags (
      bookmark_id, tag_id, source, confidence, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `,

  GET_BOOKMARK_TAGS: `
    SELECT t.* FROM tags t
    JOIN bookmark_tags bt ON t.id = bt.tag_id
    WHERE bt.bookmark_id = ?
  `,

  // ========== Categories ==========
  INSERT_CATEGORY: `
    INSERT INTO categories (name, name_pinyin, icon, color, created_at)
    VALUES (?, ?, ?, ?, ?)
  `,

  GET_ALL_CATEGORIES: `
    SELECT c.*, COUNT(b.id) as bookmark_count
    FROM categories c
    LEFT JOIN bookmarks b ON b.user_category_id = c.id
    GROUP BY c.id
    HAVING bookmark_count > 0
    ORDER BY c.sort_order, c.name
  `,

  SET_BOOKMARK_CATEGORY: `
    UPDATE bookmarks SET user_category_id = ?, last_updated = ?
    WHERE id = ?
  `,

  UPDATE_CATEGORY: `
    UPDATE categories SET name = ?, name_pinyin = ?, last_updated = ?
    WHERE id = ?
  `,

  DELETE_CATEGORY: `
    DELETE FROM categories WHERE id = ?
  `,

  GET_CATEGORY_BY_ID: `
    SELECT * FROM categories WHERE id = ?
  `,

  GET_CATEGORY_BY_NAME: `
    SELECT * FROM categories WHERE name = ?
  `,

  FIND_CATEGORIES_BY_PREFIX: `
    SELECT * FROM categories 
    WHERE name LIKE ? OR name_pinyin LIKE ?
    ORDER BY sort_order, name
    LIMIT ?
  `,

  CLEAR_BOOKMARK_CATEGORY: `
    UPDATE bookmarks SET user_category_id = NULL, last_updated = ?
    WHERE id = ?
  `,

  // ========== Search History ==========
  INSERT_SEARCH_HISTORY: `
    INSERT INTO search_history (
      query, query_lower, search_type, result_count, searched_at
    ) VALUES (?, LOWER(?), ?, ?, ?)
  `,

  UPDATE_SEARCH_SELECTED: `
    UPDATE search_history SET selected_bookmark_id = ?
    WHERE id = ?
  `,

  GET_RECENT_SEARCHES: `
    SELECT DISTINCT query, MAX(searched_at) as last_searched
    FROM search_history
    GROUP BY query_lower
    ORDER BY last_searched DESC
    LIMIT ?
  `,

  // ========== Stats ==========
  GET_BOOKMARK_COUNT: `SELECT COUNT(*) as count FROM bookmarks`,
  GET_SUMMARY_COUNT: `SELECT COUNT(*) as count FROM ai_summaries`,
  GET_TAG_COUNT: `SELECT COUNT(*) as count FROM tags`,
  GET_PENDING_COUNT: `SELECT COUNT(*) as count FROM bookmarks WHERE status = 'pending'`,

  // ========== Sync Log ==========
  INSERT_SYNC_LOG: `
    INSERT INTO sync_log (action, bookmark_id, status, message, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `,

  GET_RECENT_LOGS: `
    SELECT * FROM sync_log ORDER BY timestamp DESC LIMIT ?
  `,

  // ========== 获取所有书签用于搜索索引 ==========
  GET_ALL_FOR_INDEX: `
    SELECT b.*, s.summary_text, s.summary_text_lower,
      GROUP_CONCAT(DISTINCT t.name) as tag_names,
      GROUP_CONCAT(DISTINCT t.name_pinyin) as tag_pinyins,
      c.name as category_name,
      c.name_pinyin as category_pinyin
    FROM bookmarks b
    LEFT JOIN ai_summaries s ON b.id = s.bookmark_id
    LEFT JOIN bookmark_tags bt ON b.id = bt.bookmark_id
    LEFT JOIN tags t ON bt.tag_id = t.id
    LEFT JOIN categories c ON b.user_category_id = c.id
    GROUP BY b.id
  `,

  // ========== History Records (! 搜索) ==========
  UPSERT_HISTORY_RECORD: `
    INSERT INTO history_records (
      title, url, page_description, favicon_url,
      source_type, search_query, bookmark_id,
      visit_count, first_visit_at, last_visit_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      title = excluded.title,
      page_description = COALESCE(excluded.page_description, page_description),
      favicon_url = COALESCE(excluded.favicon_url, favicon_url),
      visit_count = visit_count + 1,
      last_visit_at = excluded.last_visit_at
  `,

  UPDATE_HISTORY_TIME_SPENT: `
    UPDATE history_records SET total_time_spent = total_time_spent + ?
    WHERE id = ?
  `,

  GET_HISTORY_BY_URL: `
    SELECT * FROM history_records WHERE url = ?
  `,

  GET_ALL_HISTORY_FOR_INDEX: `
    SELECT * FROM history_records
    ORDER BY last_visit_at DESC
    LIMIT ?
  `,

  SEARCH_HISTORY: `
    SELECT * FROM history_records
    WHERE title LIKE ? OR url LIKE ? OR page_description LIKE ?
    ORDER BY visit_count DESC, last_visit_at DESC
    LIMIT ?
  `,

  DELETE_OLD_HISTORY: `
    DELETE FROM history_records
    WHERE id NOT IN (
      SELECT id FROM history_records ORDER BY last_visit_at DESC LIMIT ?
    )
  `,
} as const;
