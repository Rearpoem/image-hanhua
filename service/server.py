"""Loopback OCR with offline or explicitly selected contextual API translation."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
from pathlib import Path
import queue
import re
import secrets
import tempfile
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from ai import read_config, save_config, translate_blocks
import ocr

import ctranslate2
import sentencepiece
from PIL import Image, ImageOps, UnidentifiedImageError

ROOT = Path(__file__).resolve().parent.parent
PORT = 17863
ORIGIN = f"http://127.0.0.1:{PORT}"
MAX_BYTES = 12 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 24_000_000
MODEL_ROOT = ROOT / "models" / "en-zh"
META = next(MODEL_ROOT.glob("*/metadata.json"), None)
if META is None:
    raise SystemExit("缺少离线模型，请先运行安装脚本")
MODEL = META.parent
KOREAN_MODEL = ROOT / "models" / "m2m100-ko-zh"
if not (KOREAN_MODEL / "model.bin").exists():
    raise SystemExit("缺少韩中直译模型，请先运行安装脚本")
TOKEN_FILE = ROOT / "runtime" / "pairing-token.txt"
TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
if not TOKEN_FILE.exists():
    TOKEN_FILE.write_text(secrets.token_urlsafe(32))
    TOKEN_FILE.chmod(0o600)
TOKEN = TOKEN_FILE.read_text(encoding="utf-8").strip()
ocr.check()
translator = ctranslate2.Translator(str(MODEL / "model"), device="cpu", compute_type="int8", inter_threads=1, intra_threads=4)
tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(MODEL / "sentencepiece.model"))
korean_translator = ctranslate2.Translator(str(KOREAN_MODEL), device="cpu", compute_type="int8", inter_threads=1, intra_threads=4)
korean_tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(KOREAN_MODEL / "sentencepiece.bpe.model"))
JOBS: dict[str, dict] = {}
LOCK = threading.Lock()
TASKS: queue.Queue = queue.Queue(maxsize=12)
CACHE: OrderedDict = OrderedDict()


def run_model(text: str, engine, encoder, target: str) -> str:
    # Sentence splitting needs no network-downloaded language resources.
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z])", text) if s.strip()]
    tokens = [encoder.encode(s, out_type=str) for s in sentences]
    if not tokens:
        return ""
    results = engine.translate_batch(tokens, beam_size=4, max_decoding_length=512)
    text = ("" if target == "zh" else " ").join(encoder.decode(r.hypotheses[0]).replace("▁", " ").strip() for r in results)
    if target != "zh":
        return text.strip()
    text = re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])", "", text)
    return re.sub(r"\s+([。，！？；：])", r"\1", text).strip()


def source_language(text: str) -> str:
    return "ko" if re.search(r"[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]", text) else "en"


def translate(text: str) -> str:
    if source_language(text) == "ko":
        # M2M100 uses explicit source and target language tokens, with no English pivot.
        source = ["__ko__"] + korean_tokenizer.encode(text, out_type=str) + ["</s>"]
        result = korean_translator.translate_batch([source], target_prefix=[["__zh__"]], beam_size=4, max_decoding_length=512)[0]
        target = [piece for piece in result.hypotheses[0] if piece not in {"__zh__", "</s>", "<s>", "<pad>"}]
        chinese = korean_tokenizer.decode(target).replace("▁", " ").strip()
        return re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])", "", chinese)
    # In interface text, "save changes" means persist edits, not save money.
    if text.strip().rstrip(".!?").casefold() in {"save changes", "save the changes"}:
        return "保存更改。"
    return run_model(text, translator, tokenizer, "zh")


def merge_lines(lines: list[dict]) -> list[dict]:
    """Join adjacent aligned lines, retaining separate distant text boxes."""
    groups: list[dict] = []
    for line in sorted(lines, key=lambda b: (b["y"], b["x"])):
        if line["confidence"] < 0.35 or not re.search(r"[A-Za-z]{2}|[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]", line["text"]):
            continue
        target = None
        for g in reversed(groups):
            last = g["last"]
            gap = line["y"] - last["y"] - last["height"]
            overlap = min(last["x"] + last["width"], line["x"] + line["width"]) - max(last["x"], line["x"])
            aligned = abs(last["x"] - line["x"]) < max(last["height"], line["height"]) * 0.8
            similar_size = 0.82 < last["height"] / max(line["height"], 0.001) < 1.22
            if -0.1 * last["height"] <= gap <= 0.7 * max(last["height"], line["height"]) and aligned and similar_size and overlap > min(last["width"], line["width"]) * 0.65:
                target = g
                break
        if target:
            right = max(target["x"] + target["width"], line["x"] + line["width"])
            bottom = max(target["y"] + target["height"], line["y"] + line["height"])
            target["x"] = min(target["x"], line["x"])
            target["width"] = right - target["x"]
            target["height"] = bottom - target["y"]
            target["text"] += " " + line["text"]
            target["last"] = line
            target["line_height"] = min(target["line_height"], line["height"])
        else:
            groups.append({**line, "last": line, "line_height": line["height"]})
    return groups


def process_image(encoded: str, ocr_only=False) -> dict:
    if not isinstance(encoded, str) or len(encoded) > MAX_BYTES * 4 // 3 + 1024:
        raise ValueError("图片超过 12 MB，或格式不正确")
    if "," in encoded:
        header, encoded = encoded.split(",", 1)
        if not header.startswith("data:image/") or ";base64" not in header:
            raise ValueError("只支持图片的 base64 数据")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise ValueError("图片数据无效") from exc
    if len(raw) > MAX_BYTES:
        raise ValueError("图片超过 12 MB")
    key = hashlib.sha256(raw).hexdigest() + (":ocr" if ocr_only else ":local")
    if key in CACHE:
        CACHE.move_to_end(key)
        return CACHE[key]
    try:
        with Image.open(io.BytesIO(raw)) as opened:
            if opened.width * opened.height > 24_000_000:
                raise ValueError("图片超过 2400 万像素，请缩小后重试")
            image = ImageOps.exif_transpose(opened).convert("RGB")
            image.thumbnail((2400, 2400))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("无法读取图片，请使用 PNG、JPEG、WebP 等普通图片") from exc
    with tempfile.TemporaryDirectory(prefix="image-ocr-", dir=ROOT / "runtime") as temp:
        path = Path(temp) / "image.png"
        image.save(path)
        recognized = ocr.recognize(path, image.width, image.height)
    boxes = []
    for group in merge_lines(recognized["lines"])[:160]:
        text = group["text"][:1600]
        chinese = "" if ocr_only else translate(text)
        boxes.append({k: group[k] for k in ("x", "y", "width", "height", "line_height")} | {"original": text, "translation": chinese, "source": source_language(text)})
    output = {"width": recognized["width"], "height": recognized["height"], "boxes": boxes, "source": "auto", "target": "zh"}
    CACHE[key] = output
    while len(CACHE) > 64:
        CACHE.popitem(last=False)
    return output


def worker():
    while True:
        job_id, payload, kind, config = TASKS.get()
        with LOCK:
            JOBS[job_id].update(state="running", updatedAt=time.time(), startedAt=time.time())
        try:
            def report(progress):
                with LOCK:
                    JOBS[job_id].update(progress=progress, updatedAt=time.time())
            report({"phase": "本机识别图片" if kind == "image" and payload.get("ocrOnly") else ("准备 AI 翻译" if kind == "ai" else "本机翻译图片")})
            output = translate_blocks(payload, config, report) if kind == "ai" else process_image(payload["image"], payload.get("ocrOnly") is True)
            result = {"state": "done", "result": output}
        except Exception as exc:
            result = {"state": "failed", "error": str(exc)[:300]}
        with LOCK:
            JOBS[job_id].update(result, finished=time.time(), updatedAt=time.time())
        TASKS.task_done()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass  # Never log URLs, pairing tokens, pictures, or recognized text.

    def valid_host(self):
        return self.headers.get("Host") in {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}

    def allowed_origin(self):
        origin = self.headers.get("Origin", "")
        return not origin or origin == ORIGIN or bool(re.fullmatch(r"chrome-extension://[a-p]{32}", origin))

    def send(self, status, data, mime="application/json; charset=utf-8"):
        body = json.dumps(data, ensure_ascii=False).encode() if mime.startswith("application/json") else data
        self.send_response(status)
        origin = self.headers.get("Origin")
        if origin and self.allowed_origin():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def gate(self, auth=False):
        if not self.valid_host() or not self.allowed_origin():
            self.send(403, {"error": "拒绝非本地来源"})
            return False
        if auth and not secrets.compare_digest(self.headers.get("Authorization", ""), "Bearer " + TOKEN):
            self.send(401, {"error": "配对码不正确，请打开本地设置页重新复制"})
            return False
        return True

    def do_OPTIONS(self):
        if self.gate():
            self.send(200, {})

    def do_GET(self):
        if not self.gate():
            return
        path = urlparse(self.path).path
        if path == "/health":
            self.send(200, {"ready": True, "version": "0.4.0", "ocr": ocr.BACKEND, "source": "auto", "sources": ["en", "ko"], "target": "zh", "modes": ["local", "ai"], "koreanPath": "ko-zh-direct"})
        elif path == "/config":
            if self.gate(auth=True):
                self.send(200, read_config(public=True))
        elif path == "/ai-settings":
            page = (ROOT / "examples" / "ai-settings.html").read_text(encoding="utf-8").replace("PAIRING_TOKEN", TOKEN)
            self.send(200, page.encode(), "text/html; charset=utf-8")
        elif path.startswith("/jobs/"):
            if not self.gate(auth=True):
                return
            with LOCK:
                stored = JOBS.get(path.removeprefix("/jobs/"))
                job = dict(stored) if stored else None
            self.send(200 if job else 404, job or {"error": "任务已过期，请重试"})
        elif path == "/setup":
            page = (ROOT / "examples" / "setup.html").read_text(encoding="utf-8").replace("PAIRING_TOKEN", TOKEN)
            self.send(200, page.encode(), "text/html; charset=utf-8")
        else:
            routes = {"/": ROOT / "examples" / "demo.html", "/demo": ROOT / "examples" / "demo.html",
                      "/demo.js": ROOT / "examples" / "demo.js", "/demo.css": ROOT / "examples" / "demo.css",
                      "/engine.js": ROOT / "extension" / "engine.js", "/sample.png": ROOT / "examples" / "sample.png",
                      "/blank.png": ROOT / "examples" / "blank.png", "/large.png": ROOT / "examples" / "large.png",
                      "/korean.png": ROOT / "examples" / "korean.png"}
            routes.update({"/jobs.js": ROOT / "extension" / "jobs.js", "/ai-settings.js": ROOT / "extension" / "ai-settings.js", "/ui.css": ROOT / "extension" / "ui.css"})
            file = routes.get(path)
            if not file or not file.exists():
                self.send(404, {"error": "页面不存在"})
                return
            mime = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png"}[file.suffix]
            data = file.read_bytes()
            if file.suffix == ".html":
                data = data.replace(b"PAIRING_TOKEN", TOKEN.encode())
            self.send(200, data, mime)

    def do_POST(self):
        if not self.gate(auth=True):
            self.close_connection = True
            return
        path = urlparse(self.path).path
        if path not in {"/jobs", "/ai/jobs", "/config"}:
            self.send(404, {"error": "接口不存在"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BYTES * 4 // 3 + 2048:
                self.close_connection = True
                self.send(413, {"error": "图片超过 12 MB"})
                return
            self.connection.settimeout(15)
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError()
            if path == "/config":
                try:
                    self.send(200, save_config(payload))
                except ValueError as exc:
                    self.send(400, {"error": str(exc)})
                return
            image = payload.get("image")
            if path == "/jobs" and not isinstance(image, str):
                raise ValueError("缺少图片数据")
            with LOCK:
                expired = [k for k, v in JOBS.items() if time.time() - v.get("finished", time.time()) > 600]
                for k in expired:
                    del JOBS[k]
                job_id = secrets.token_urlsafe(18)
                JOBS[job_id] = {"state": "pending", "createdAt": time.time(), "updatedAt": time.time(), "progress": {"phase": "排队等待本地服务"}}
                try:
                    TASKS.put_nowait((job_id, payload, "ai" if path == "/ai/jobs" else "image", read_config() if path == "/ai/jobs" else None))
                except queue.Full:
                    del JOBS[job_id]
                    self.send(429, {"error": "正在处理其他图片，请稍后重试"})
                    return
            self.send(202, {"id": job_id})
        except (ValueError, TypeError, AttributeError):
            self.send(400, {"error": "请求格式不正确"})


if __name__ == "__main__":
    threading.Thread(target=worker, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True
    print(f"本地图片翻译已启动：{ORIGIN}/setup", flush=True)
    print("关闭此窗口或按 Ctrl+C 停止。本机识别；AI 模式使用配置的远程接口。", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
