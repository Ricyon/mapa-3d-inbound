
const VENDOR_URLS = {
  "/vendor/tailwind.js": "https://cdn.tailwindcss.com",
  "/vendor/lucide.js": "https://unpkg.com/lucide@1.50.0",
  "/vendor/three.min.js": "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
  "/vendor/OrbitControls.js": "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js",
  "/vendor/xlsx.full.min.js": "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"
};

async function handleVendor(request) {
  const url = new URL(request.url);
  const upstream = VENDOR_URLS[url.pathname];
  if (!upstream) return new Response("Not found", { status: 404 });

  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await fetch(upstream, { cf: { cacheTtl: 31536000, cacheEverything: true } });
  if (!response.ok) return new Response("Falha ao carregar biblioteca", { status: 502 });

  const headers = new Headers(response.headers);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.delete("set-cookie");
  const proxied = new Response(response.body, { status: response.status, headers });
  await cache.put(cacheKey, proxied.clone());
  return proxied;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

function isAuthorized(request, env) {
  if (!env.ADMIN_KEY) return false;
  const supplied = request.headers.get("x-admin-key") || "";
  return supplied.length > 0 && supplied === env.ADMIN_KEY;
}

function cleanText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeItem(item) {
  const qty = Number(item?.qty);
  return {
    code: cleanText(item?.code, 80),
    desc: cleanText(item?.desc, 300),
    qty: Number.isFinite(qty) ? Math.abs(qty) : 0
  };
}

function validateInventory(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Formato de inventário inválido.");
  }

  const entries = Object.entries(raw);
  if (entries.length > 500) throw new Error("Quantidade de posições acima do limite esperado.");

  const clean = {};
  let rowCount = 0;

  for (const [positionRaw, itemsRaw] of entries) {
    const position = cleanText(positionRaw, 10).toUpperCase();
    if (!/^Z[C-J]\d{2}$/.test(position)) continue;
    if (!Array.isArray(itemsRaw)) continue;
    if (itemsRaw.length > 150) throw new Error(`Muitos materiais na posição ${position}.`);

    const items = itemsRaw
      .map(normalizeItem)
      .filter((item) => item.code || item.desc);

    if (items.length) {
      clean[position] = items;
      rowCount += items.length;
    }
  }

  return { inventory: clean, rowCount };
}

async function getMeta(env) {
  const { results = [] } = await env.DB.prepare(
    "SELECT key, value FROM app_meta WHERE key IN ('version','last_updated','source_file','row_count','position_count')"
  ).all();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

async function handleGetInventory(request, env) {
  const meta = await getMeta(env);
  const version = meta.version || "empty";
  const etag = `W/\"${version}\"`;

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag, "cache-control": "no-store" } });
  }

  const { results = [] } = await env.DB.prepare(
    "SELECT position, items_json FROM inventory_positions ORDER BY position"
  ).all();

  const inventory = {};
  for (const row of results) {
    try {
      inventory[row.position] = JSON.parse(row.items_json);
    } catch {
      inventory[row.position] = [];
    }
  }

  return json({
    ok: true,
    version,
    lastUpdated: meta.last_updated || null,
    sourceFile: meta.source_file || null,
    rowCount: Number(meta.row_count || 0),
    positionCount: Number(meta.position_count || results.length),
    inventory
  }, 200, { etag });
}

async function handleGetStatus(env) {
  const meta = await getMeta(env);
  const history = await env.DB.prepare(
    "SELECT imported_at, source_file, row_count, position_count, version FROM import_history ORDER BY id DESC LIMIT 5"
  ).all();
  return json({ ok: true, meta, history: history.results || [] });
}

async function handleImport(request, env) {
  if (!env.ADMIN_KEY) {
    return json({ ok: false, error: "ADMIN_KEY ainda não foi configurada no Worker." }, 503);
  }
  if (!isAuthorized(request, env)) {
    return json({ ok: false, error: "Chave de atualização inválida." }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400);
  }

  let validated;
  try {
    validated = validateInventory(body.inventory);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const filename = cleanText(body.filename || "Atualização manual", 180);
  const positions = Object.entries(validated.inventory);
  const now = new Date().toISOString();
  const version = crypto.randomUUID();

  const statements = [env.DB.prepare("DELETE FROM inventory_positions")];
  const insert = env.DB.prepare(
    "INSERT INTO inventory_positions (position, items_json, item_count, updated_at) VALUES (?1, ?2, ?3, ?4)"
  );

  for (const [position, items] of positions) {
    statements.push(insert.bind(position, JSON.stringify(items), items.length, now));
  }

  const metaInsert = env.DB.prepare(
    "INSERT INTO app_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  statements.push(metaInsert.bind("version", version));
  statements.push(metaInsert.bind("last_updated", now));
  statements.push(metaInsert.bind("source_file", filename));
  statements.push(metaInsert.bind("row_count", String(validated.rowCount)));
  statements.push(metaInsert.bind("position_count", String(positions.length)));
  statements.push(
    env.DB.prepare(
      "INSERT INTO import_history (imported_at, source_file, row_count, position_count, version) VALUES (?1, ?2, ?3, ?4, ?5)"
    ).bind(now, filename, validated.rowCount, positions.length, version)
  );

  try {
    await env.DB.batch(statements);
  } catch (error) {
    return json({ ok: false, error: `Falha ao salvar no banco: ${error.message}` }, 500);
  }

  return json({
    ok: true,
    version,
    lastUpdated: now,
    sourceFile: filename,
    rowCount: validated.rowCount,
    positionCount: positions.length
  });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/inventory") return handleGetInventory(request, env);
  if (request.method === "GET" && url.pathname === "/api/status") return handleGetStatus(env);
  if (request.method === "POST" && url.pathname === "/api/import") return handleImport(request, env);
  if (request.method === "GET" && url.pathname === "/api/health") return json({ ok: true, service: "mapa-3d-inbound" });
  return json({ ok: false, error: "Rota não encontrada." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    if (url.pathname.startsWith("/vendor/")) return handleVendor(request);
    return env.ASSETS.fetch(request);
  }
};
