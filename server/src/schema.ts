// Drizzle schema for this space.
//
// `sales` — every sale Débora registers in the app, split into the two
// fronts of the Pingou Venda strategy:
//   - segment "gestao"      = Gestão: vendas locais, acompanhadas no painel.
//   - segment "marketplace" = Marketplace: vendas nos nichos da vitrine.
// `niche` on each sale is the niche picked when the account was created
// (or typed in by hand), so local sales and marketplace sales can be read
// niche by niche.
// Money is stored as integer cents (unit_price_cents) so totals never drift
// with floating point. `date` is the sale's calendar day as YYYY-MM-DD
// text, which sorts and range-filters correctly as a plain string.
//
// `business_profile` — the single account row: store name and the niche
// chosen at sign-up. It drives the panel copy, the form categories and the
// niche filter.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sales = sqliteTable("sales", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  item: text("item").notNull(),
  category: text("category").notNull().default(""),
  size: text("size").notNull().default(""),
  quantity: integer("quantity").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull(),
  date: text("date").notNull(),
  channel: text("channel").notNull().default("Loja"),
  // Frente da venda na estratégia Pingou Venda:
  // "gestao" = Gestão (vendas locais), "marketplace" = Marketplace (nichos).
  segment: text("segment", { enum: ["gestao", "marketplace"] })
    .notNull()
    .default("gestao"),
  // Nicho da venda (o nicho da conta ou um nicho digitado na hora).
  niche: text("niche").notNull().default(""),
  // Produto do estoque vendido (quando a venda veio da seleção, sem digitar).
  productId: integer("product_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// `products` — o estoque que a pessoa monta, nicho por nicho
// (vestuario, eletronicos, imports). Cada produto tem nome, categoria,
// variação (tamanho, cor, modelo, ano…), preço e quantidade em estoque.
// Vender pela seleção baixa o estoque automaticamente.
export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  niche: text("niche").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull().default(""),
  variant: text("variant").notNull().default(""),
  priceCents: integer("price_cents").notNull(),
  stock: integer("stock").notNull().default(0),
  // 1 = liberado para revenda (aparece no painel do revendedor).
  resale: integer("resale").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const businessProfile = sqliteTable("business_profile", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessName: text("business_name").notNull().default(""),
  niche: text("niche").notNull().default(""),
  nicheCustom: text("niche_custom").notNull().default(""),
  // E-mail da conta e fim do período grátis (7 dias a partir da criação).
  email: text("email").notNull().default(""),
  // Hash SHA-256 (com sal) da senha da conta — nunca a senha em texto puro.
  // Vazio = conta antiga, criada antes da senha existir: a primeira senha
  // digitada no login passa a valer como senha da conta.
  passwordHash: text("password_hash").notNull().default(""),
  trialEndsAt: integer("trial_ends_at").notNull().default(0),
  // Logo da empresa enviada na criação da conta (blob próprio).
  logoBlobKey: text("logo_blob_key").notNull().default(""),
  updatedAt: integer("updated_at").notNull().default(0),
});

// `members` — pessoas cadastradas pela dona (ou por elas mesmas na aba
// Revenda): revendedores e vendedores. O revendedor entra com o e-mail
// e vê só o que está liberado para revenda.
export const members = sqliteTable("members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role", { enum: ["revendedor", "vendedor"] })
    .notNull()
    .default("revendedor"),
  active: integer("active").notNull().default(1),
  createdAt: integer("created_at").notNull().default(0),
});

// `notifications` — avisos para a dona (ADM): novo cadastro, etc.
export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull().default("cadastro"),
  message: text("message").notNull(),
  isRead: integer("is_read").notNull().default(0),
  createdAt: integer("created_at").notNull().default(0),
});

// `app_settings` — chave/valor simples (ex.: código de acesso do ADM).
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
});
