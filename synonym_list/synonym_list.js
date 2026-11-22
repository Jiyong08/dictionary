import {
  STORAGE_KEY,
  cleanWordToken,
  loadCombinedSynonymList,
  rowsToTabText,
} from './synonym_store.js';

const els = {
  form: document.getElementById('search-form'),
  input: document.getElementById('search-input'),
  resetBtn: document.getElementById('reset-btn'),
  copyBtn: document.getElementById('copy-txt-btn'),
  downloadBtn: document.getElementById('download-txt-btn'),
  clearExtraBtn: document.getElementById('clear-extra-btn'),
  results: document.getElementById('results-area'),
  stats: document.getElementById('stats-badge'),
};

let allRows = [];

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderList(rawQuery = '') {
  const q = cleanWordToken(rawQuery);
  const filtered = q
    ? allRows.filter((row) => row.some((w) => w.includes(q)))
    : allRows;

  if (!filtered.length) {
    els.results.innerHTML = `<div class="empty-state"><strong>"${escapeHtml(rawQuery)}"</strong>에 해당하는 유의어 묶음이 없습니다.</div>`;
    return;
  }

  const statusText = q
    ? `"${escapeHtml(rawQuery)}" 검색 결과: 총 <strong>${filtered.length.toLocaleString()}</strong>개 묶음 (전체 ${allRows.length.toLocaleString()}개 중)`
    : `전체 유의어 목록 (좌우 · 상하 가나다순): 총 <strong>${filtered.length.toLocaleString()}</strong>개 묶음`;

  const rowsHtml = filtered
    .map((row, idx) => {
      const chips = row
        .map((w, wIdx) => {
          const isMatch = q && w.includes(q);
          const cls = isMatch ? 'word-chip is-match' : wIdx === 0 ? 'word-chip is-head' : 'word-chip';
          return `<button type="button" class="${cls}" data-word="${escapeHtml(w)}" title="'${escapeHtml(w)}' 포함 목록 보기">${escapeHtml(w)}</button>`;
        })
        .join('');
      return `
        <tr>
          <td class="row-num">${idx + 1}</td>
          <td><div class="word-chips">${chips}</div></td>
        </tr>
      `;
    })
    .join('');

  els.results.innerHTML = `
    <div class="status-line">${statusText}</div>
    <div class="table-card">
      <table class="syn-table">
        <thead>
          <tr>
            <th class="row-num">번호</th>
            <th>유의어 묶음 (좌우 가나다순)</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

async function init() {
  const { rows, extraCount } = await loadCombinedSynonymList('./synonym_list.txt');
  allRows = rows;
  const totalWords = allRows.reduce((acc, r) => acc + r.length, 0);
  els.stats.textContent = `총 ${allRows.length.toLocaleString()}개 묶음 · ${totalWords.toLocaleString()}개 어휘${extraCount ? ` (브라우저 추가 ${extraCount}건 포함)` : ''}`;
  els.clearExtraBtn?.classList.toggle('hidden', extraCount === 0);
  renderList(els.input.value);
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  renderList(els.input.value);
});

els.input.addEventListener('input', () => {
  renderList(els.input.value);
});

els.resetBtn.addEventListener('click', () => {
  els.input.value = '';
  renderList('');
});

els.results.addEventListener('click', (e) => {
  const btn = e.target.closest('.word-chip[data-word]');
  if (!btn) return;
  const w = btn.dataset.word || '';
  els.input.value = w;
  renderList(w);
});

els.copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(rowsToTabText(allRows));
    alert('전체 유의어 목록(탭 구분)을 클립보드에 복사했습니다.');
  } catch {
    alert('클립보드 복사에 실패했습니다.');
  }
});

els.downloadBtn.addEventListener('click', () => {
  const blob = new Blob([rowsToTabText(allRows)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'synonym_list.txt';
  a.click();
  URL.revokeObjectURL(url);
});

els.clearExtraBtn?.addEventListener('click', async () => {
  if (!confirm('브라우저에 임시 추가된 유의어 항목을 초기화하고 기본 파일(synonym_list.txt)만 표시할까요?')) return;
  localStorage.removeItem(STORAGE_KEY);
  await init();
});

init();
