const DATA_BASE = './data';
const bucketCache = new Map();
let metaPromise = null;

const els = {
  form: document.getElementById('search-form'),
  input: document.getElementById('search-input'),
  mode: document.getElementById('search-mode'),
  results: document.getElementById('results-area'),
  stats: document.getElementById('stats-badge'),
};

function cleanQuery(raw) {
  return String(raw || '')
    .normalize('NFC')
    .replace(/\[[^\]]*\]/g, (m) => m) // 괄호 안 표기 유지 후 기호만 제거
    .replace(/[-‐‑‒–—−^:\s()\[\]]+/g, '')
    .trim();
}

function cleanSynForSearch(raw) {
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
  const data = await res.json();
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

  // prefix 검색: 시작 키가 속하거나 겹치는 버킷(최대 4개)
  for (let i = 0; i < buckets.length; i++) {
    const [minK, maxK, fname] = buckets[i];
    if (maxK >= key && (minK <= key || minK.startsWith(key))) {
      matches.push(fname);
      if (matches.length >= 4) break;
    }
  }
  return matches;
}

function renderResults(queryRaw, key, items, mode) {
  if (!items.length) {
    els.results.innerHTML = `<div class="empty-state"><strong>"${escapeHtml(queryRaw)}"</strong>에 해당하는 유의어 항목을 찾지 못했습니다.</div>`;
    return;
  }

  const maxShow = 60;
  const shown = items.slice(0, maxShow);
  const statusHtml = `<div class="status-line">"${escapeHtml(queryRaw)}" 검색 결과: 총 <strong>${items.length.toLocaleString()}</strong>개 표제어${items.length > maxShow ? ` (상위 ${maxShow}개 표시)` : ''}</div>`;

  const cardsHtml = shown
    .map(([k, displayWord, senses]) => {
      const sensesHtml = senses
        .map(([pos, defn, syns], idx) => {
          const posBadge = pos ? `<span class="sense-pos">${escapeHtml(pos)}</span>` : '';
          const synChips = syns
            .map(
              (sw) =>
                `<button type="button" class="syn-chip" data-syn="${escapeHtml(sw)}" title="'${escapeHtml(sw)}' 유의어 검색">${escapeHtml(sw)}</button>`
            )
            .join('');
          return `
            <div class="sense-item">
              <div class="sense-def">
                ${senses.length > 1 ? `<span class="sense-num">${idx + 1}.</span>` : ''}
                ${posBadge}${escapeHtml(defn)}
              </div>
              <div class="syn-list">
                <span class="syn-label">유의어</span>
                ${synChips}
              </div>
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
    })
    .join('');

  els.results.innerHTML = statusHtml + cardsHtml;
}

async function runSearch(rawQuery, pushHash = true) {
  const q = String(rawQuery || '').trim();
  if (!q) return;
  const key = cleanQuery(q);
  const mode = els.mode.value;

  if (pushHash) {
    const nextHash = `#q=${encodeURIComponent(q)}`;
    if (window.location.hash !== nextHash) {
      history.pushState(null, '', nextHash);
    }
  }

  els.results.innerHTML = '<div class="empty-state">검색 중...</div>';

  try {
    const meta = await loadMeta();
    const bucketFiles = findCandidateBuckets(meta.buckets, key, mode);
    if (!bucketFiles.length) {
      renderResults(q, key, [], mode);
      return;
    }

    const bucketArrays = await Promise.all(bucketFiles.map(loadBucket));
    const matched = [];
    for (const rows of bucketArrays) {
      for (const row of rows) {
        const k = row[0];
        if (mode === 'exact' ? k === key : k.startsWith(key)) {
          matched.push(row);
        }
      }
    }

    // 정확 일치를 맨 위로 정렬
    matched.sort((a, b) => {
      const aEq = a[0] === key ? 0 : 1;
      const bEq = b[0] === key ? 0 : 1;
      if (aEq !== bEq) return aEq - bEq;
      return a[0].localeCompare(b[0], 'ko');
    });

    renderResults(q, key, matched, mode);
  } catch (err) {
    els.results.innerHTML = `<div class="empty-state">오류가 발생했습니다: ${escapeHtml(err.message)}</div>`;
  }
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch(els.input.value);
});

document.querySelectorAll('.example-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const q = btn.dataset.q || '';
    els.input.value = q;
    runSearch(q);
  });
});

els.results.addEventListener('click', (e) => {
  const chip = e.target.closest('.syn-chip[data-syn]');
  if (!chip) return;
  const rawSyn = chip.dataset.syn || '';
  const q = cleanSynForSearch(rawSyn) || rawSyn;
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
    els.stats.textContent = `표제어 ${meta.total_words.toLocaleString()}개 · 어의 ${meta.total_senses.toLocaleString()}개 · 유의어 ${meta.total_links.toLocaleString()}건`;
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
