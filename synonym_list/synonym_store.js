export const STORAGE_KEY = 'onmalmoi_synonym_list_v1';

export function cleanWordToken(raw) {
  return String(raw || '')
    .normalize('NFC')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[-‐‑‒–—−^:]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeRowTokens(tokens) {
  const seen = new Set();
  const out = [];
  for (const t of tokens || []) {
    const c = cleanWordToken(t);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  out.sort((a, b) => a.localeCompare(b, 'ko'));
  return out;
}

export function sortRows(rows) {
  return [...rows].sort((a, b) => (a[0] || '').localeCompare(b[0] || '', 'ko'));
}

export function parseTabText(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tokens = normalizeRowTokens(trimmed.split('\t'));
    if (tokens.length >= 2) {
      rows.push(tokens);
    }
  }
  return rows;
}

export function deduplicateRows(rows) {
  const result = [];
  const sigSet = new Set();
  for (const rawRow of rows) {
    const row = normalizeRowTokens(rawRow);
    if (row.length < 2) continue;
    const sig = row.join('\t');
    if (sigSet.has(sig)) continue;
    sigSet.add(sig);
    result.push(row);
  }
  return sortRows(result);
}

export function getSavedExtraRows() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveExtraRows(rows) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // ignore storage quota errors
  }
}

export async function loadCombinedSynonymList(txtUrl) {
  let baseRows = [];
  try {
    const res = await fetch(`${txtUrl}?v=${Date.now()}`);
    if (res.ok) {
      baseRows = parseTabText(await res.text());
    }
  } catch {
    // fallback to localStorage only
  }
  const extraRows = getSavedExtraRows();
  return {
    rows: deduplicateRows([...baseRows, ...extraRows]),
    extraCount: extraRows.length,
  };
}

export async function addSynonymEntry(rawWords, txtUrl) {
  const newRow = normalizeRowTokens(rawWords);
  if (newRow.length < 2) {
    return { added: false, message: '표제어와 유의어(최소 2개 이상)가 필요합니다.' };
  }

  const { rows: existingRows } = await loadCombinedSynonymList(txtUrl);
  const newSet = new Set(newRow);

  for (const ex of existingRows) {
    const exSet = new Set(ex);
    const isSubset = newRow.every((w) => exSet.has(w));
    if (isSubset) {
      return {
        added: false,
        reason: 'duplicate',
        message: `이미 유의어 목록에 포함된 내용입니다: ${ex.join(' / ')}`,
      };
    }
  }

  const extra = getSavedExtraRows();
  extra.push(newRow);
  const dedupedExtra = deduplicateRows(extra);
  saveExtraRows(dedupedExtra);

  const combined = deduplicateRows([...existingRows, newRow]);
  return {
    added: true,
    row: newRow,
    totalCount: combined.length,
    message: `유의어 목록에 추가되었습니다 (${newRow.join(' · ')})`,
  };
}

export function rowsToTabText(rows) {
  return rows.map((r) => r.join('\t')).join('\n') + '\n';
}
