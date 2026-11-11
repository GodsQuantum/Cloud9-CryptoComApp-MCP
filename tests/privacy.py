#!/usr/bin/env python3
from pathlib import Path
import subprocess,re,json,xml.etree.ElementTree as ET
base=Path(__file__).resolve().parent.parent
files=subprocess.check_output(["git","-C",str(base),"ls-files","-z"]).decode().split(chr(0))
bad=[]
checks=[re.compile(x,re.I) for x in ["a"+"rezki","chou"+"gar","kech"+"idi","fe"+"lla",r"192[.]168[.]",
 r"home[.]arpa",r"@gmail[.]com",r"/srv/"+"lxc/",r"-----BEGIN PRIVATE KEY",
 r"ghp_[A-Za-z0-9]{25,}",r"github_pat_[A-Za-z0-9_]{25,}"]]
for name in files:
 if not name or name=="tests/privacy.py":continue
 f=base/name
 if not f.is_file() or f.stat().st_size>350000:continue
 if any(p.search(f.read_text(errors="replace")) for p in checks):bad.append(name)
assert not bad,("PRIVATE_DATA_BLOCKED",bad)
names=json.loads((base/"tests/tool-names.json").read_text())
hashes=json.loads((base/"tests/tool-schema-sha256.json").read_text())
assert len(names)==len(set(names))==7 and set(names)==set(hashes)
assert all(len(x)==64 for x in hashes.values())
ET.parse(base/"docs/logo.svg");ET.parse(base/"docs/tools.svg")
print("CRYPTO_APP_PUBLIC_WRAPPER_PRIVACY_AND_7_TOOL_CONTRACT_PASS")
