"""Local text recognition: the macOS Vision helper, or RapidOCR on other systems.

Both backends return {"width", "height", "lines": [{text, confidence, x, y, width, height}]}
with coordinates normalized to 0..1 and the origin at the top left.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = os.environ.get("IMAGE_HANHUA_OCR") or ("vision" if sys.platform == "darwin" else "rapidocr")
_engine = None
_engine_lock = threading.Lock()


def check() -> None:
    if BACKEND == "vision":
        if not (ROOT / "runtime" / "ocr").exists():
            raise SystemExit("缺少文字识别程序，请先运行安装脚本")
    else:
        _rapidocr()


def _rapidocr():
    global _engine
    with _engine_lock:
        if _engine is None:
            from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR
            # The Korean recognition model also reads Latin text, so one pass covers both languages.
            _engine = RapidOCR(params={"Rec.lang_type": LangRec.KOREAN, "Rec.ocr_version": OCRVersion.PPOCRV5,
                                       "Rec.model_type": ModelType.MOBILE, "Global.log_level": "error"})
        return _engine


def recognize(path: Path, width: int, height: int) -> dict:
    if BACKEND == "vision":
        result = subprocess.run([str(ROOT / "runtime" / "ocr"), str(path)], capture_output=True, timeout=40)
        if result.returncode:
            raise RuntimeError("本地文字识别失败：" + result.stderr.decode(errors="replace").strip()[:200])
        return json.loads(result.stdout)
    output = _rapidocr()(str(path))
    lines = []
    for box, text, score in zip(output.boxes if output.boxes is not None else [], output.txts or [], output.scores or []):
        xs = [float(point[0]) for point in box]
        ys = [float(point[1]) for point in box]
        if not text:
            continue
        lines.append({"text": text, "confidence": float(score),
                      "x": min(xs) / width, "y": min(ys) / height,
                      "width": (max(xs) - min(xs)) / width, "height": (max(ys) - min(ys)) / height})
    return {"width": width, "height": height, "lines": lines}


if __name__ == "__main__":
    # `python service/ocr.py --warmup` downloads the RapidOCR models during installation.
    if sys.argv[1:] == ["--warmup"]:
        check()
        print("文字识别模型已就绪", flush=True)
    elif len(sys.argv) == 2:
        from PIL import Image
        with Image.open(sys.argv[1]) as image:
            size = image.size
        print(json.dumps(recognize(Path(sys.argv[1]), *size), ensure_ascii=False, indent=2))
    else:
        raise SystemExit("用法：python service/ocr.py --warmup | <图片路径>")
