/**
 * AI 智能识别课表 Excel —— 把表格预览发给 AI 网关，自动推断：
 *   ① 学校档案（grid 格子表 / records 一行一节）
 *   ② records 模式下的列映射（className/teacher/weeks/day/period/location）
 *   ③ 学期信息（学年/学期/开学日期/总周数）
 * ④ 直接产出解析后的课程条目（供向导预览，用户确认后导入）
 *
 * 失败降级：AI 不可用/超时 → 回落传统档案自动猜测（profiles.detectProfile），保证向导永远可用。
 */
import { aiComplete, type AiChatMessage } from '../cloud/aiGateway';
import { detectProfile, listProfiles, getProfile } from '../xls/profiles';
import { autoMapping, parseRecords, toRecords } from '../xls/profiles/generic';
import type { FieldMapping, ProfileInfo } from '../xls/profiles/types';
import type { ParsedClassItem } from '../core/ustbTypes';

export interface AiXlsRecognition {
  ok: boolean;
  source: 'ai' | 'fallback';
  profileId: string;
  confidence: number;
  mapping: FieldMapping | null;
  term?: { xn: string; xq: '1' | '2'; semesterStart?: string; totalWeeks?: number };
  items: ParsedClassItem[];
  warnings: string[];
  /** AI 的原始解释（向导里可折叠展示，建立信任） */
  reasoning?: string;
}

/** 表格 → 紧凑文本（前 40 行 × 12 列，控制 token） */
function sheetToText(aoa: any[][]): string {
  const rows = aoa.slice(0, 40).map((r) =>
    (r || []).slice(0, 12).map((c) => String(c ?? '').replace(/\s+/g, ' ').slice(0, 24)).join(' | '),
  );
  return rows.join('\n');
}

const SYSTEM_PROMPT = `你是课表 Excel 解析助手。用户给你一个从教务系统导出的表格（文本化前若干行）。
请推断并只输出一个 JSON 对象（不要 markdown 代码块）：
{
  "layout": "grid" | "records",          // grid=行是节次列是星期的格子表；records=一行一节课
  "profile": "generic" | "qilu",         // 有齐鲁理工特征（如"齐鲁""一节大节"）选 qilu，否则 generic
  "mapping": {                            // records 模式必填：列号从 0 开始
    "className": number, "teacher": number, "weeks": number,
    "day": number, "period": number, "location": number
  } | null,
  "term": { "xn": "2025-2026", "xq": 1|2, "semesterStart": "YYYY-MM-DD"|null, "totalWeeks": number|null },
  "confidence": 0-100,
  "reasoning": "一句话解释判断依据"
}`;

export async function recognizeTimetableXls(
  sheetName: string,
  aoa: any[][],
): Promise<AiXlsRecognition> {
  const text = sheetToText(aoa);
  const messages: AiChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `工作表名：${sheetName}\n\n表格内容：\n${text}` },
  ];

  try {
    const { content } = await aiComplete(messages, { model: undefined });
    const jsonText = extractJson(content);
    const j = JSON.parse(jsonText);
    const profileId: string = j.profile === 'qilu' ? 'qilu' : 'generic';
    const mapping: FieldMapping | null = j.layout === 'records' && j.mapping
      ? {
          className: Number(j.mapping.className) || 0,
          teacher: Number(j.mapping.teacher) || 1,
          weeks: Number(j.mapping.weeks) || 2,
          day: Number(j.mapping.day) || 3,
          period: Number(j.mapping.period) || 4,
          location: Number(j.mapping.location) || 5,
        }
      : null;

    // 用 AI 的判断走传统解析管线（保证条目结构与手动导入完全一致）
    const profile = getProfile(profileId) || getProfile('generic')!;
    let items: ParsedClassItem[] = [];
    const warnings: string[] = [];
    if (profile.layout === 'records') {
      const { headers, rows } = toRecords(aoa);
      const useMapping = mapping || autoMapping(headers);
      const parsed = parseRecords(headers, rows, useMapping);
      items = parsed.items;
      warnings.push(...parsed.warnings);
    } else {
      const parsed = profile.parse(aoa);
      items = parsed.items;
      warnings.push(...(parsed.warnings || []));
    }

    return {
      ok: true,
      source: 'ai',
      profileId,
      confidence: Number(j.confidence) || 70,
      mapping,
      term: j.term
        ? {
            xn: String(j.term.xn || ''),
            xq: j.term.xq === 2 ? '2' : '1',
            semesterStart: j.term.semesterStart ?? undefined,
            totalWeeks: j.term.totalWeeks ?? undefined,
          }
        : undefined,
      items,
      warnings,
      reasoning: String(j.reasoning || ''),
    };
  } catch (e) {
    console.warn('[xls-ai] AI 识别失败，降级传统猜测:', e);
    return fallbackRecognize(sheetName, aoa);
  }
}

/** 传统降级路径：detectProfile 置信度猜测 */
function fallbackRecognize(sheetName: string, aoa: any[][]): AiXlsRecognition {
  const detected = detectProfile(aoa);
  const profile = getProfile(detected.id) || getProfile('generic')!;
  const warnings: string[] = [];
  let items: ParsedClassItem[] = [];
  let mapping: FieldMapping | null = null;
  if (profile.layout === 'records') {
    const { headers, rows } = toRecords(aoa);
    mapping = autoMapping(headers);
    const parsed = parseRecords(headers, rows, mapping);
    items = parsed.items;
    warnings.push(...parsed.warnings);
  } else {
    const parsed = profile.parse(aoa);
    items = parsed.items;
    warnings.push(...(parsed.warnings || []));
  }
  return {
    ok: items.length > 0,
    source: 'fallback',
    profileId: profile.id,
    confidence: detected.confidence,
    mapping,
    items,
    warnings,
  };
}

function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  throw new Error('AI 响应中没有 JSON');
}
