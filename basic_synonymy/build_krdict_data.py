#!/usr/bin/env python3
"""
한국어기초사전 LMF JSON 파일(11개)을 파싱하여
표제어·품사·뜻풀이·유의어·반의어(반대말) 정보를 포함한
GitHub Pages 정적 검색용 가나다순 gzip 샤드(.json.gz)를 생성한다.
"""

from __future__ import annotations

import gzip
import json
import os
from pathlib import Path
import re
import shutil
import time

SRC_DIR = Path(r"F:\내 드라이브\AG\dictionary\한국어기초사전_json_20261119")
OUT_DIR = Path(__file__).resolve().parent / "data"
NUM_BUCKETS = 64

_RE_CLEAN = re.compile(r"[-‐‑‒–—−^:\s]+")


def feats_to_dict(feats) -> dict[str, str]:
    if isinstance(feats, dict):
        feats = [feats]
    if not isinstance(feats, list):
        return {}
    out: dict[str, str] = {}
    for f in feats:
        if isinstance(f, dict) and "att" in f:
            out[str(f["att"])] = str(f.get("val") or "")
    return out


def as_list(val) -> list:
    if isinstance(val, list):
        return val
    if val is None or val == "":
        return []
    return [val]


def main() -> None:
    t0 = time.perf_counter()
    if not SRC_DIR.exists():
        raise FileNotFoundError(f"한국어기초사전 폴더 없음: {SRC_DIR}")

    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    json_files = sorted(SRC_DIR.glob("*.json"))
    if not json_files:
        raise FileNotFoundError(f"JSON 파일 없음: {SRC_DIR}")

    # word_clean -> {"w": display_word, "senses": [[pos, defn, syns, ants], ...]}
    grouped: dict[str, dict] = {}
    total_entries = 0
    total_senses = 0
    total_syn_senses = 0
    total_ant_senses = 0
    total_syn_links = 0
    total_ant_links = 0

    for fp in json_files:
        data = json.loads(fp.read_text(encoding="utf-8"))
        entries = as_list(data.get("LexicalResource", {}).get("Lexicon", {}).get("LexicalEntry"))
        for it in entries:
            if not isinstance(it, dict):
                continue
            total_entries += 1
            lemma_nodes = as_list(it.get("Lemma"))
            lemma_node = lemma_nodes[0] if lemma_nodes and isinstance(lemma_nodes[0], dict) else {}
            lemma_feats = feats_to_dict(lemma_node.get("feat"))
            word = lemma_feats.get("writtenForm", "").strip()
            if not word:
                continue
            entry_feats = feats_to_dict(it.get("feat"))
            pos = entry_feats.get("partOfSpeech", "").strip()
            hom_no = entry_feats.get("homonym_number", "").strip()
            if hom_no == "0":
                hom_no = ""
            display_word = f"{word} ({hom_no})" if hom_no else word

            key = _RE_CLEAN.sub("", word)
            if not key:
                continue

            senses_raw = as_list(it.get("Sense"))
            for s in senses_raw:
                if not isinstance(s, dict):
                    continue
                s_feats = feats_to_dict(s.get("feat"))
                defn = s_feats.get("definition", "").strip()
                if not defn:
                    continue

                syns: list[str] = []
                ants: list[str] = []
                for rel in as_list(s.get("SenseRelation")):
                    if not isinstance(rel, dict):
                        continue
                    r_feats = feats_to_dict(rel.get("feat"))
                    r_type = r_feats.get("type", "").strip()
                    r_lemma = r_feats.get("lemma", "").strip()
                    if not r_lemma or r_lemma == word:
                        continue
                    if r_type in ("유의어", "비슷한말", "동의어"):
                        if r_lemma not in syns:
                            syns.append(r_lemma)
                    elif r_type in ("반대말", "반의어"):
                        if r_lemma not in ants:
                            ants.append(r_lemma)

                entry = grouped.get(key)
                if entry is None:
                    entry = {"w": word, "senses": []}
                    grouped[key] = entry

                # 동형어 구분을 위해 품사 앞에 동형어 번호가 있으면 표기
                pos_label = f"{pos} · {hom_no}" if (pos and hom_no) else (pos or (f"동형어 {hom_no}" if hom_no else ""))
                if syns or ants:
                    entry["senses"].append([pos_label, defn, syns, ants])
                    if syns:
                        total_syn_senses += 1
                        total_syn_links += len(syns)
                    if ants:
                        total_ant_senses += 1
                        total_ant_links += len(ants)
                else:
                    entry["senses"].append([pos_label, defn])
                total_senses += 1

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
        fname = f"b{b_idx:03d}.json.gz"
        payload = [
            [k, grouped[k]["w"], grouped[k]["senses"]]
            for k in slice_keys
        ]
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        gz_bytes = gzip.compress(raw, compresslevel=6)
        (OUT_DIR / fname).write_bytes(gz_bytes)
        total_bytes += len(gz_bytes)
        buckets_meta.append([slice_keys[0], slice_keys[-1], fname, len(slice_keys)])

    meta = {
        "source": "한국어기초사전 (국립국어원)",
        "total_words": n_keys,
        "total_senses": total_senses,
        "total_syn_senses": total_syn_senses,
        "total_ant_senses": total_ant_senses,
        "total_syn_links": total_syn_links,
        "total_ant_links": total_ant_links,
        "gzip": True,
        "buckets": buckets_meta,
    }
    meta_bytes = json.dumps(meta, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    (OUT_DIR / "meta.json").write_bytes(meta_bytes)
    total_bytes += len(meta_bytes)

    print(
        f"파일 {len(json_files)}개 | 항목: {total_entries:,}건 | 표제어: {n_keys:,}개 | 어의: {total_senses:,}개\n"
        f"유의어 보유 어의: {total_syn_senses:,}개 (링크 {total_syn_links:,}개) | 반의어 보유 어의: {total_ant_senses:,}개 (링크 {total_ant_links:,}개)\n"
        f"버킷: {len(buckets_meta)}개 | 총 용량(gzip): {total_bytes / (1024**2):.2f} MB | 소요: {time.perf_counter() - t0:.1f}s"
    )


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUTF8", "1")
    main()
