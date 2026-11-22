#!/usr/bin/env python3
"""
우리말샘 SQLite DB(opendict.db)에서 유의어('비슷한말'/'유의어'/'동의어') 보유 항목과
뜻풀이를 추출하여 GitHub Pages 정적 검색용 가나다순 샤드 JSON을 생성한다.
"""

from __future__ import annotations

from collections import defaultdict
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import time
import zlib

OPENDICT_DB = Path(r"C:\Users\ji-yo\AppData\Local\Onmalmoi\db\dicts\opendict.db")
OUT_DIR = Path(__file__).resolve().parent / "data"
NUM_BUCKETS = 256

_RE_TRAIL_NUM = re.compile(r"\d{3}$")
_RE_CLEAN = re.compile(r"[-‐‑‒–—−^:\s]+")


def clean_syn_word(w: str) -> str:
    s = _RE_TRAIL_NUM.sub("", str(w or "").strip()).strip()
    return s


def main() -> None:
    t0 = time.perf_counter()
    if not OPENDICT_DB.exists():
        raise FileNotFoundError(f"opendict.db 없음: {OPENDICT_DB}")

    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(OPENDICT_DB)
    cur = conn.execute("SELECT word, word_clean, pos, detail_json_z FROM entries")

    # word_clean -> {"w": display_word, "senses": [[pos, defn, [syn...]], ...]}
    grouped: dict[str, dict] = {}
    total_scanned = 0
    total_senses = 0
    total_links = 0

    for word, wc, pos, blob in cur:
        total_scanned += 1
        obj = json.loads(zlib.decompress(blob).decode("utf-8"))
        wi = obj.get("word_info") or obj.get("wordinfo") or {}
        si_list = obj.get("sense_info") or obj.get("senseinfo") or obj.get("sense") or []
        if isinstance(si_list, dict):
            si_list = [si_list]

        # word_info 수준 relation_info
        wi_rels = wi.get("relation_info") or wi.get("relationinfo") or []
        if isinstance(wi_rels, dict):
            wi_rels = [wi_rels]
        wi_syns = [
            clean_syn_word(r.get("word") or "")
            for r in wi_rels
            if isinstance(r, dict) and str(r.get("type") or "").strip() in ("비슷한말", "유의어", "동의어")
        ]

        for s in si_list:
            if not isinstance(s, dict):
                continue
            rels = s.get("relation_info") or s.get("relationinfo") or []
            if isinstance(rels, dict):
                rels = [rels]
            s_syns = [
                clean_syn_word(r.get("word") or "")
                for r in rels
                if isinstance(r, dict) and str(r.get("type") or "").strip() in ("비슷한말", "유의어", "동의어")
            ]
            all_syns = []
            for sw in (*s_syns, *wi_syns):
                if sw and sw != word and sw not in all_syns:
                    all_syns.append(sw)
            if not all_syns:
                continue

            defn = str(s.get("definition") or "").strip()
            s_pos = str(s.get("pos") or pos or "").strip()
            if not defn:
                continue

            key = wc or _RE_CLEAN.sub("", word)
            if not key:
                continue
            entry = grouped.get(key)
            if entry is None:
                entry = {"w": word, "senses": []}
                grouped[key] = entry
            entry["senses"].append([s_pos, defn, all_syns])
            total_senses += 1
            total_links += len(all_syns)

    conn.close()

    sorted_keys = sorted(grouped.keys())
    n_keys = len(sorted_keys)
    chunk_size = max(1, (n_keys + NUM_BUCKETS - 1) // NUM_BUCKETS)

    buckets_meta = []
    total_bytes = 0
    for b_idx in range(0, NUM_BUCKETS):
        start = b_idx * chunk_size
        if start >= n_keys:
            break
        end = min(n_keys, start + chunk_size)
        slice_keys = sorted_keys[start:end]
        fname = f"b{b_idx:03d}.json"
        payload = [
            [k, grouped[k]["w"], grouped[k]["senses"]]
            for k in slice_keys
        ]
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        (OUT_DIR / fname).write_bytes(raw)
        total_bytes += len(raw)
        buckets_meta.append([slice_keys[0], slice_keys[-1], fname, len(slice_keys)])

    meta = {
        "source": "우리말샘 (국립국어원)",
        "total_words": n_keys,
        "total_senses": total_senses,
        "total_links": total_links,
        "buckets": buckets_meta,
    }
    meta_bytes = json.dumps(meta, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    (OUT_DIR / "meta.json").write_bytes(meta_bytes)
    total_bytes += len(meta_bytes)

    print(f"스캔: {total_scanned:,}건 | 표제어: {n_keys:,}개 | 어의: {total_senses:,}개 | 유의어 링크: {total_links:,}개")
    print(f"버킷 파일 수: {len(buckets_meta)}개 | 총 용량: {total_bytes / (1024**2):.2f} MB | 소요: {time.perf_counter() - t0:.1f}s")


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUTF8", "1")
    main()
