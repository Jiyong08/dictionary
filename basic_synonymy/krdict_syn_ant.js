import { addSynonymEntry } from '../synonym_list/synonym_store.js';

const SYN_LIST_TXT_URL = '../synonym_list/synonym_list.txt';
const DATA_BASE = './data';
const bucketCache = new Map();
let metaPromise = null;

const els = {
  form: document.getElementById('search-form'),
  input: document.getElementById('search-input'),
  mode: document.getElementById('search-mode'),
  scope: document.getElementById('rel-scope'),
  results: document.getElementById('results-area'),
  stats: document.getElementById('stats-badge'),
};

function cleanQuery(raw) {
  return String(raw || '')
    .normalize('NFC')
    .replace(/[-‐‑‒–—−^:\s()\[\]]+/g, '')
    .trim();
}

function cleanRelForSearch(raw) {
  return String(raw || '')
    .normalize('NFC')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[-‐‑‒–—−^:\s()]+/g, '')
    .trim();
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function loadMeta() {
  if (!metaPromise) {
    metaPromise = fetch(`${DATA_BASE}/meta.json`).then((r) => {
      if (!r.ok) throw new Error('메타데이터를 불러오지 못했습니다.');
      return r.json();
    });
  }
  return metaPromise;
}

async function loadBucket(fileName) {
  if (bucketCache.has(fileName)) return bucketCache.get(fileName);
  const res = await fetch(`${DATA_BASE}/${fileName}`);
  if (!res.ok) throw new Error(`데이터 파일(${fileName}) 로드 실패`);
  let data;
  if (fileName.endsWith('.gz')) {
    if (typeof DecompressionStream !== 'undefined' && res.body) {
      const ds = new DecompressionStream('gzip');
      data = await new Response(res.body.pipeThrough(ds)).json();
    } else {
      throw new Error('이 브라우저는 gzip 압축 해제를 지원하지 않습니다.');
    }
  } else {
    data = await res.json();
  }
  bucketCache.set(fileName, data);
  return data;
}

function findCandidateBuckets(buckets, key, mode) {
  if (!key || !buckets.length) return [];
  const matches = [];
  if (mode === 'exact') {
    let lo = 0;
    let hi = buckets.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [minK, maxK, fname] = buckets[mid];
      if (key < minK) hi = mid - 1;
      else if (key > maxK) lo = mid + 1;
      else return [fname];
    }
    return [];
  }

  for (let i = 0; i < buckets.length; i++) {
    const [minK, maxK, fname] = buckets[i];
    if (maxK >= key && (minK <= key || minK.startsWith(key))) {
      matches.push(fname);
      if (matches.length >= 16) break;
    }
  }
  return matches;
}

function getScopeLabel(scope) {
  if (scope === 'rel_only') return '유의어·반의어가 있는 표제어';
  if (scope === 'syn_only') return '유의어가 있는 표제어';
  if (scope === 'ant_only') return '반의어가 있는 표제어';
  return '전체 표제어';
}

let lastMatchedState = { queryRaw: '', items: [], mode: 'exact', scope: 'syn_only', shownCount: 200 };

function renderCardHtml([k, displayWord, senses]) {
  const sensesHtml = senses
    .map(([pos, defn, syns, ants], idx) => {
      const posBadge = pos ? `<span class="sense-pos">${escapeHtml(pos)}</span>` : '';
      const synList = Array.isArray(syns) ? syns : [];
      const antList = Array.isArray(ants) ? ants : [];
      const synHtml = synList.length
        ? `<div class="rel-row">
            <span class="rel-label">유의어</span>
            ${synList
              .map(
                (sw) =>
                  `<button type="button" class="syn-chip" data-rel="${escapeHtml(sw)}" title="'${escapeHtml(sw)}' 검색">${escapeHtml(sw)}</button>`
              )
              .join('')}
            <button type="button" class="add-syn-btn" data-words="${escapeHtml(JSON.stringify([displayWord, ...synList]))}">+ 유의어 목록 추가</button>
          </div>`
        : '';
      const antHtml = antList.length
        ? `<div class="rel-row">
            <span class="rel-label">반의어</span>
            ${antList
              .map(
                (aw) =>
                  `<button type="button" class="ant-chip" data-rel="${escapeHtml(aw)}" title="'${escapeHtml(aw)}' 검색">${escapeHtml(aw)}</button>`
              )
              .join('')}
          </div>`
        : '';

      return `
        <div class="sense-item">
          <div class="sense-def">
            ${senses.length > 1 ? `<span class="sense-num">${idx + 1}.</span>` : ''}
            ${posBadge}${escapeHtml(defn)}
          </div>
          ${synHtml}
          ${antHtml}
        </div>
      `;
    })
    .join('');

  return `
    <article class="entry-card">
      <div class="entry-head">
        <span class="entry-word">${escapeHtml(displayWord)}</span>
      </div>
      ${sensesHtml}
    </article>
  `;
}

function renderResults(queryRaw, key, items, mode, scope, shownCount = 200) {
  const modeLabel = queryRaw ? (mode === 'exact' ? '일치' : '시작 문자') : '전체 목록';
  const scopeLabel = getScopeLabel(scope);
  if (!items.length) {
    els.results.innerHTML = `<div class="empty-state"><strong>"${escapeHtml(queryRaw || '전체')}"</strong> (${modeLabel} · ${scopeLabel})에 해당하는 표제어를 찾지 못했습니다.</div>`;
    return;
  }

  lastMatchedState = { queryRaw, items, mode, scope, shownCount };
  const shown = items.slice(0, shownCount);
  const totalSenses = items.reduce((acc, r) => acc + (r[2]?.length || 0), 0);
  const titlePrefix = queryRaw ? `"${escapeHtml(queryRaw)}" 검색 결과` : '전체 조회 결과';
  const statusHtml = `<div class="status-line">${titlePrefix} (${modeLabel} · ${scopeLabel}): 총 <strong>${items.length.toLocaleString()}</strong>개 표제어, <strong>${totalSenses.toLocaleString()}</strong>개 뜻풀이${items.length > shown.length ? ` (${shown.length.toLocaleString()}개 표시 중)` : ''}</div>`;

  const cardsHtml = shown.map(renderCardHtml).join('');
  const remain = items.length - shown.length;
  const moreHtml = remain > 0
    ? `<div class="load-more-bar">
        <button type="button" class="load-more-btn" data-more="200">다음 200개 더 보기 (남은 ${remain.toLocaleString()}개)</button>
        <button type="button" class="load-more-btn" data-more="all">전체 모두 보기</button>
      </div>`
    : '';

  els.results.innerHTML = statusHtml + cardsHtml + moreHtml;
}

async function runSearch(rawQuery, pushHash = true) {
  const q = String(rawQuery || '').trim();
  const key = cleanQuery(q);
  const mode = els.mode?.value || 'exact';
  const scope = els.scope?.value || 'syn_only';

  if (pushHash) {
    const nextHash = q ? `#q=${encodeURIComponent(q)}` : '';
    if (window.location.hash !== nextHash) {
      history.pushState(null, '', nextHash || window.location.pathname + window.location.search);
    }
  }

  els.results.innerHTML = '<div class="empty-state">검색 중...</div>';

  try {
    const meta = await loadMeta();
    const bucketFiles = key
      ? findCandidateBuckets(meta.buckets, key, mode)
      : meta.buckets.map((b) => b[2]);
    if (!bucketFiles.length) {
      renderResults(q, key, [], mode, scope);
      return;
    }

    const bucketArrays = [];
    for (let i = 0; i < bucketFiles.length; i += 16) {
      const chunk = await Promise.all(bucketFiles.slice(i, i + 16).map(loadBucket));
      bucketArrays.push(...chunk);
    }

    const matched = [];
    for (const rows of bucketArrays) {
      for (const row of rows) {
        const k = row[0];
        if (key && !(mode === 'exact' ? k === key : k.startsWith(key))) continue;
        if (scope === 'all') {
          matched.push(row);
        } else {
          const filteredSenses = (row[2] || []).filter((s) => {
            const hasSyn = Array.isArray(s[2]) && s[2].length > 0;
            const hasAnt = Array.isArray(s[3]) && s[3].length > 0;
            if (scope === 'syn_only') return hasSyn;
            if (scope === 'ant_only') return hasAnt;
            return hasSyn || hasAnt;
          });
          if (!filteredSenses.length) continue;
          matched.push([row[0], row[1], filteredSenses]);
        }
      }
    }

    if (key) {
      matched.sort((a, b) => {
        const aEq = a[0] === key ? 0 : 1;
        const bEq = b[0] === key ? 0 : 1;
        if (aEq !== bEq) return aEq - bEq;
        return a[0].localeCompare(b[0], 'ko');
      });
    }

    renderResults(q, key, matched, mode, scope, 200);
  } catch (err) {
    els.results.innerHTML = `<div class="empty-state">오류가 발생했습니다: ${escapeHtml(err.message)}</div>`;
  }
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch(els.input.value);
});

els.mode?.addEventListener('change', () => {
  if (els.input.value.trim() || lastMatchedState.items.length) runSearch(els.input.value, false);
});

els.scope?.addEventListener('change', () => {
  if (els.input.value.trim() || lastMatchedState.items.length) runSearch(els.input.value, false);
});

document.querySelectorAll('.example-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const q = btn.dataset.q || '';
    els.input.value = q;
    runSearch(q);
  });
});

els.results.addEventListener('click', async (e) => {
  const addBtn = e.target.closest('.add-syn-btn[data-words]');
  if (addBtn) {
    try {
      const words = JSON.parse(addBtn.dataset.words || '[]');
      const res = await addSynonymEntry(words, SYN_LIST_TXT_URL);
      addBtn.textContent = res.added ? '✓ 목록에 추가됨' : '이미 목록에 있음';
      addBtn.classList.add('is-done');
      if (!res.added && res.message) alert(res.message);
    } catch (err) {
      alert(`추가 실패: ${err.message}`);
    }
    return;
  }

  const moreBtn = e.target.closest('.load-more-btn[data-more]');
  if (moreBtn) {
    const more = moreBtn.dataset.more;
    const nextCount = more === 'all' ? lastMatchedState.items.length : lastMatchedState.shownCount + 200;
    renderResults(
      lastMatchedState.queryRaw,
      cleanQuery(lastMatchedState.queryRaw),
      lastMatchedState.items,
      lastMatchedState.mode,
      lastMatchedState.scope,
      nextCount
    );
    return;
  }

  const chip = e.target.closest('.syn-chip[data-rel], .ant-chip[data-rel]');
  if (!chip) return;
  const rawRel = chip.dataset.rel || '';
  const q = cleanRelForSearch(rawRel) || rawRel;
  els.input.value = q;
  runSearch(q);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

window.addEventListener('hashchange', () => {
  const m = window.location.hash.match(/q=([^&]+)/);
  if (m) {
    const q = decodeURIComponent(m[1]);
    els.input.value = q;
    runSearch(q, false);
  }
});

(async function init() {
  try {
    const meta = await loadMeta();
    els.stats.textContent = `표제어 ${meta.total_words.toLocaleString()}개 · 어의 ${meta.total_senses.toLocaleString()}개 · 유의어 ${meta.total_syn_links.toLocaleString()}건 · 반의어 ${meta.total_ant_links.toLocaleString()}건`;
  } catch {
    els.stats.textContent = '메타데이터 로드 실패';
  }
  const m = window.location.hash.match(/q=([^&]+)/);
  if (m) {
    const q = decodeURIComponent(m[1]);
    els.input.value = q;
    runSearch(q, false);
  }
})();
