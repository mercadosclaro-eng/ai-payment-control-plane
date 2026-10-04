"""Run pinned AgentKit conformance in a fresh directory (Python 3.12+, Node 24+).
Setup downloads public fixtures. Tests use no funds or production credentials.
"""
import base64
import hashlib
import io
from pathlib import Path
import subprocess
import tarfile
import tempfile
from urllib.request import urlopen

SCHEMA_URL = "https://raw.githubusercontent.com/baianomarceloeduardo-jpg/agentkit/29ab0dcaa8d642126695c1330025afc2fa3bd80c/typescript/agentkit/src/action-providers/automatonFirewall/schemas.ts"
SCHEMA_BLOB = "566ddacb9edb350b51353e74e4d16e0271f2b95d"
ZOD_URL = "https://registry.npmjs.org/zod/-/zod-4.4.3.tgz"
ZOD_SHA512 = "ytENFjIJFl2UwYglde2jchW2Hwm4GJFLDiSXWdTrJQBIN9Fcyp7n4DhxJEiWNAJMV1/BqWfW/kkg71UDcHJyTQ=="

def download(url):
    with urlopen(url, timeout=60) as response:
        return response.read()

def main():
    import os
    root = Path(__file__).resolve().parents[2]
    schema = download(SCHEMA_URL)
    actual = hashlib.sha1(b"blob " + str(len(schema)).encode() + b"\0" + schema).hexdigest()
    if actual != SCHEMA_BLOB:
        raise RuntimeError("Upstream schema bytes changed")
    archive = download(ZOD_URL)
    if base64.b64encode(hashlib.sha512(archive).digest()).decode() != ZOD_SHA512:
        raise RuntimeError("Zod archive integrity mismatch")
    with tempfile.TemporaryDirectory(prefix="varyntiq-agentkit-") as directory:
        isolated = Path(directory)
        (isolated / "package.json").write_text('{"private":true,"type":"module"}', encoding="utf-8")
        schema_path = isolated / "schemas.mjs"
        schema_path.write_bytes(schema)
        modules = isolated / "node_modules"
        modules.mkdir()
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as bundle:
            members = bundle.getmembers()
            for member in members:
                parts = Path(member.name).parts
                if not parts or parts[0] != "package" or ".." in parts or not (member.isfile() or member.isdir()):
                    raise RuntimeError("Unexpected archive entry")
            bundle.extractall(modules, members=members, filter="data")
        (modules / "package").rename(modules / "zod")
        env = os.environ.copy()
        env["AGENTKIT_SCHEMA_PATH"] = str(schema_path)
        env.pop("NODE_PATH", None)
        tests = [
            "integrations/agentkit/varyntiq-agentkit-schema.test.mjs",
            "integrations/agentkit/varyntiq-agentkit-native-bridge.test.mjs",
            "integrations/agentkit/varyntiq-agentkit.fixture.test.mjs",
        ]
        print("Verified schema blob and Zod SHA-512; fresh isolated directory; no npm or lifecycle scripts.", flush=True)
        return subprocess.run(["node", "--test", *tests], cwd=root, env=env, check=False).returncode

if __name__ == "__main__":
    raise SystemExit(main())

