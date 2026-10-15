"""Extract the official model inside this tool's folder, without global installs."""
from pathlib import Path
import hashlib
import json
import stat
import zipfile

root = Path(__file__).resolve().parent.parent
packages = [
    ("en-zh", "en", "zh", "1_9", "433e7c4f034d87fbe2353161e05f18646d7999452f801a4e1f0378522b9850ab"),
]
for name, source, target, version, expected in packages:
    archive = root / "models" / (name + ".argosmodel")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != expected:
        raise SystemExit(f"{name} 模型校验失败，请重新下载官方模型")
    destination = root / "models" / name
    destination.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as package:
        for info in package.infolist():
            path = (destination / info.filename).resolve()
            if not path.is_relative_to(destination.resolve()) or stat.S_ISLNK(info.external_attr >> 16):
                raise SystemExit("模型压缩包包含无效路径")
        package.extractall(destination)
    meta_path = next(destination.glob("*/metadata.json"))
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    if metadata.get("from_code") != source or metadata.get("to_code") != target:
        raise SystemExit("模型语言不匹配")
    record = {"source": f"https://argos-net.com/v1/translate-{source}_{target}-{version}.argosmodel", "sha256": digest, "metadata": metadata}
    filename = "model-info.json" if name == "en-zh" else "ko-en-model-info.json"
    (root / "models" / filename).write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{source} → {target} 离线模型已就绪")
