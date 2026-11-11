import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";

process.env.CDC_API_KEY ||= process.env.CDCX_API_KEY;
process.env.CDC_API_SECRET ||= process.env.CDCX_API_SECRET;

const SKILL_DIR = "/app/upstream/crypto-com-app";
const TSX = "/app/node_modules/.bin/tsx";

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

type SkillResult = { ok?: boolean; data?: any; error?: string; error_message?: string };

function runSkill(script: string, args: string[], timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [`${SKILL_DIR}/scripts/${script}`, ...args], {
      cwd: SKILL_DIR,
      env: {
        ...process.env,
        CDC_API_KEY: process.env.CDC_API_KEY || "",
        CDC_API_SECRET: process.env.CDC_API_SECRET || "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const maxBytes = 32 * 1024 * 1024;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Crypto.com skill command timed out"));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > maxBytes) {
        child.kill("SIGKILL");
        reject(new Error("Crypto.com skill output exceeded safety limit"));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > maxBytes) stderr = stderr.slice(-maxBytes);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let parsed: SkillResult;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        reject(new Error(`Crypto.com skill returned invalid JSON (exit=${code}, stderr=${stderr.slice(-500)})`));
        return;
      }
      if (code !== 0 || parsed.ok !== true) {
        const category = parsed.error || "API_ERROR";
        const detail = parsed.error_message || stderr.trim() || `exit ${code}`;
        reject(new Error(`${category}: ${detail}`));
        return;
      }
      resolve(parsed.data);
    });
  });
}

function buildServer() {
  const server = new McpServer(
    { name: "cryptocom-app", version: "1.2.0" },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "account_balances",
    {
      description: "Read current Crypto.com App balances and portfolio allocation through the official Crypto.com agent skill. Read-only.",
      inputSchema: z.object({ scope: z.enum(["all", "fiat", "crypto"]).default("all") }),
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async ({ scope }) => text(await runSkill("account.ts", ["balances", scope]))
  );

  server.registerTool(
    "account_balance",
    {
      description: "Read one Crypto.com App crypto token balance and product allocation through the official Crypto.com agent skill. Read-only.",
      inputSchema: z.object({ symbol: z.string().min(2).max(16) }),
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async ({ symbol }) => text(await runSkill("account.ts", ["balance", symbol.toUpperCase()]))
  );

  server.registerTool(
    "account_trading_limit",
    {
      description: "Read the Crypto.com App Agent Key weekly trading budget, usage and remaining amount through the official Crypto.com agent skill. Read-only.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => text(await runSkill("account.ts", ["trading-limit"]))
  );

  server.registerTool(
    "account_transactions",
    {
      description: "Read recent Crypto.com App transaction history through the official Crypto.com agent skill. Read-only.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async () => text(await runSkill("trade.ts", ["history"]))
  );

  server.registerTool(
    "trade_quote",
    {
      description: "Create a Crypto.com App market trade quotation through the official Crypto.com agent skill. This does not move funds. Use purchase for fiat-to-crypto, sale for crypto-to-fiat, exchange for crypto-to-crypto.",
      inputSchema: z.object({
        type: z.enum(["purchase", "sale", "exchange"]),
        from_currency: z.string().min(2).max(16),
        to_currency: z.string().min(2).max(16),
        from_amount: z.string().min(1).optional(),
        to_amount: z.string().min(1).optional(),
        fixed_side: z.enum(["from", "to"]).optional(),
        side: z.enum(["buy", "sell"]).optional()
      }),
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => {
      const params: Record<string, string> = {
        from_currency: args.from_currency.toUpperCase(),
        to_currency: args.to_currency.toUpperCase(),
      };
      if (args.from_amount) params.from_amount = args.from_amount;
      if (args.to_amount) params.to_amount = args.to_amount;
      if (args.fixed_side) params.fixed_side = args.fixed_side;
      if (args.side) params.side = args.side;
      return text(await runSkill("trade.ts", ["quote", args.type, JSON.stringify(params)]));
    }
  );

  server.registerTool(
    "trade_confirm",
    {
      description: "Execute one previously-created, unexpired Crypto.com App quotation through the official Crypto.com agent skill. This moves real funds. Use only after an explicit user instruction authorizing the exact trade; acknowledged must be true.",
      inputSchema: z.object({
        type: z.enum(["purchase", "sale", "exchange"]),
        quotation_id: z.string().min(1),
        acknowledged: z.literal(true)
      }),
      annotations: { readOnlyHint: false, destructiveHint: true }
    },
    async ({ type, quotation_id }) => {
      if (process.env.ALLOW_LIVE_TRADES !== "true") {
        return text({ error: "Live trade confirmation is disabled. Set ALLOW_LIVE_TRADES=true only on a trusted, authenticated server." });
      }
      return text(await runSkill("trade.ts", ["confirm", type, quotation_id], 45000));
    }
  );

  server.registerTool(
    "market_search",
    {
      description: "Search Crypto.com App supported crypto assets and current market metadata/prices through the official Crypto.com agent skill. Read-only.",
      inputSchema: z.object({
        keyword: z.string().min(1).max(100),
        native_currency: z.string().min(3).max(8).default("EUR"),
        page_size: z.number().int().min(1).max(50).default(10),
        sort_by: z.enum(["rank", "market_cap", "alphabetical", "volume", "performance"]).default("rank"),
        sort_direction: z.enum(["asc", "desc"]).default("asc")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false }
    },
    async (args) => text(await runSkill("coins.ts", ["search", JSON.stringify(args)]))
  );

  return server;
}

const handler = createMcpHandler(buildServer);
const mcp = toNodeHandler(handler);
const http = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"status":"ok"}');
    return;
  }
  if (req.url?.startsWith("/mcp")) {
    void mcp(req, res);
    return;
  }
  res.writeHead(404);
  res.end();
});

http.listen(8185, "0.0.0.0", () => console.log("cryptocom-app MCP listening on :8185"));
