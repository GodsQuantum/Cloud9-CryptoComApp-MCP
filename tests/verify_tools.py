#!/usr/bin/env python3
import asyncio,hashlib,json,urllib.request
from pathlib import Path
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
base=Path(__file__).resolve().parent
url="http://127.0.0.1:18185"
expected=set(json.loads((base/"tool-names.json").read_text()))
digest=json.loads((base/"tool-schema-sha256.json").read_text())
async def run():
 assert len(expected)==7
 with urllib.request.urlopen(url+"/healthz",timeout=8) as response:
  assert response.status==200
 async with streamable_http_client(url+"/mcp") as c:
  async with ClientSession(c[0],c[1]) as sess:
   await asyncio.wait_for(sess.initialize(),timeout=30)
   tools=(await asyncio.wait_for(sess.list_tools(),timeout=30)).tools
   assert {x.name for x in tools}==expected,"Seven Crypto App MCP tools changed"
   changed=[]
   for t in tools:
    encoded=json.dumps(t.input_schema,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
    if hashlib.sha256(encoded).hexdigest()!=digest[t.name]:changed.append(t.name)
   assert not changed,("CRYPTO_APP_TOOL_SCHEMA_REGRESSION",changed)
   trade=next(t for t in tools if t.name=="trade_confirm")
   assert trade.annotations is not None and trade.annotations.destructive_hint is True, "Real trading must be annotated destructive"
   print("CRYPTO_7_MCP_NAMES_AND_INPUT_SCHEMAS_PASS",flush=True)
   print("CRYPTO_REAL_TRADE_DESTRUCTIVE_ANNOTATION_PASS",flush=True)
   output=await asyncio.wait_for(sess.call_tool("trade_confirm",{
       "type":"purchase","quotation_id":"synthetic-no-real-trade-ci",
       "acknowledged":True}),timeout=18)
   data=" ".join(getattr(x,"text","") for x in output.content)
   assert "Live trade confirmation is disabled" in data,("MISSING_DEFAULT_REAL_TRADE_GUARD",data[:180])
   print("CRYPTO_REAL_TRADES_DISABLED_WITHOUT_EXPLICIT_OPERATOR_OPTIN_PASS",flush=True)
asyncio.run(run())
