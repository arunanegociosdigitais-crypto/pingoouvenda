// Actions for this artifact: the Pingou Venda sales register + account.
//
// Strategy reflected in the data model:
//   - Gestão (segment "gestao") is for local sales, tracked in the panel.
//   - Marketplace (segment "marketplace") covers every niche.
//   - The account (business_profile) is created with a niche; the niche
//     shows up on the panel, on the sale form and on each sale row.
//
// listSales returns the sales inside an optional date range (YYYY-MM-DD,
// inclusive on both ends); the client derives every metric from that list,
// so the numbers on screen always match the rows shown.
// addSale records one sale; deleteSale removes one (used to fix mistakes).
// Money travels as integer cents end to end.

import {
defineAction,
z,
type ActionsModule,
type Ctx,
} from "@hatch/space-sdk";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import * as schema from "./schema";

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "data deve ser YYYY-MM-DD");

const segmentEnum = z.enum(["gestao", "marketplace"]);

const saleShape = z.object({
  id: z.number(),
  item: z.string(),
  category: z.string(),
  size: z.string(),
  quantity: z.number(),
  unitPriceCents: z.number(),
  date: z.string(),
  channel: z.string(),
  segment: segmentEnum,
  niche: z.string(),
  productId: z.number().nullable(),
});

const productShape = z.object({
  id: z.number(),
  niche: z.string(),
  name: z.string(),
  category: z.string(),
  variant: z.string(),
  priceCents: z.number(),
  stock: z.number(),
  resale: z.boolean(),
});

/** Rótulo bonito do nicho de um produto, para gravar na venda. */
const PRODUCT_NICHE_LABELS: Record<string, string> = {
  vestuario: "Vestuário",
  eletronicos: "Eletrônicos",
  imports: "Imports",
};

const okResponse = z.object({ ok: z.literal(true) });

const profileShape = z.object({
  businessName: z.string(),
  niche: z.string(),
  nicheCustom: z.string(),
  email: z.string(),
  trialEndsAt: z.number(),
  logoUrl: z.string().nullable(),
});

const memberShape = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  role: z.enum(["revendedor", "vendedor"]),
  active: z.boolean(),
  createdAt: z.number(),
});

const notificationShape = z.object({
  id: z.number(),
  kind: z.string(),
  message: z.string(),
  isRead: z.boolean(),
  createdAt: z.number(),
});

const emailString = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "e-mail inválido")
  .max(120);

const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;

const passwordString = z.string().min(4, "a senha precisa de 4+ caracteres").max(72);

/** SHA-256 em hex — usado para a senha (com sal) e para o token de sessão. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Hash da senha com o e-mail como sal: nunca guardamos a senha em si. */
async function hashPassword(email: string, password: string): Promise<string> {
  return sha256Hex(`pingcou-senha:${email}:${password}`);
}

/**
 * Token de sessão lembrado no aparelho: derivado do hash da senha, então
 * trocar a senha Derruba as sessões antigas automaticamente.
 */
async function sessionTokenFor(
  email: string,
  passwordHash: string,
): Promise<string> {
  return sha256Hex(`pingcou-sessao:${email}:${passwordHash}`);
}

type ProfileRow = typeof schema.businessProfile.$inferSelect;

async function toProfile(
  ctx: Ctx,
  row: ProfileRow,
): Promise<z.infer<typeof profileShape>> {
  return {
    businessName: row.businessName,
    niche: row.niche,
    nicheCustom: row.nicheCustom,
    email: row.email,
    trialEndsAt: row.trialEndsAt,
    logoUrl: row.logoBlobKey ? await ctx.blobs.getUrl(row.logoBlobKey) : null,
  };
}

/** Linhas antigas guardavam "local"/"vestuario": normaliza para a estratégia atual. */
function normalizeSegment(raw: string): "gestao" | "marketplace" {
  return raw === "marketplace" || raw === "vestuario"
    ? "marketplace"
    : "gestao";
}

export const Actions = {
  getProfile: defineAction({
    request: z.object({}),
    response: z.object({ profile: profileShape.nullable() }),
    async handler(ctx): Promise<{ profile: z.infer<typeof profileShape> | null }> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.businessProfile)
        .orderBy(desc(schema.businessProfile.id))
        .limit(1);
      const row = rows[0];
      if (!row) return { profile: null };
      return {
        profile: {
          businessName: row.businessName,
          niche: row.niche,
          nicheCustom: row.nicheCustom,
          email: row.email,
          trialEndsAt: row.trialEndsAt,
          logoUrl: row.logoBlobKey
            ? await ctx.blobs.getUrl(row.logoBlobKey)
            : null,
        },
      };
    },
  }),

  loginWithEmail: defineAction({
    request: z.object({ email: emailString, password: passwordString }),
    response: z.object({
      found: z.boolean(),
      passwordOk: z.boolean(),
      profile: profileShape.nullable(),
      sessionToken: z.string().nullable(),
    }),
    async handler(
      ctx,
      args,
    ): Promise<{
      found: boolean;
      passwordOk: boolean;
      profile: z.infer<typeof profileShape> | null;
      sessionToken: string | null;
    }> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.businessProfile)
        .where(eq(schema.businessProfile.email, args.email))
        .orderBy(desc(schema.businessProfile.id))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return { found: false, passwordOk: false, profile: null, sessionToken: null };
      }
      const typedHash = await hashPassword(args.email, args.password);
      let storedHash = row.passwordHash;
      if (!storedHash) {
        // Conta criada antes de existir senha: a senha digitada neste
        // primeiro login passa a ser a senha da conta.
        storedHash = typedHash;
        await db
          .update(schema.businessProfile)
          .set({ passwordHash: storedHash, updatedAt: Date.now() })
          .where(eq(schema.businessProfile.id, row.id));
      } else if (storedHash !== typedHash) {
        return { found: true, passwordOk: false, profile: null, sessionToken: null };
      }
      return {
        found: true,
        passwordOk: true,
        profile: await toProfile(ctx, row),
        sessionToken: await sessionTokenFor(row.email, storedHash),
      };
    },
  }),

  // Revalida a sessão lembrada neste aparelho (e-mail + token), sem pedir
  // a senha de novo a cada abertura do app.
  checkSession: defineAction({
    request: z.object({
      email: emailString,
      sessionToken: z.string().trim().min(1).max(200),
    }),
    response: z.object({ profile: profileShape.nullable() }),
    async handler(
      ctx,
      args,
    ): Promise<{ profile: z.infer<typeof profileShape> | null }> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.businessProfile)
        .where(eq(schema.businessProfile.email, args.email))
        .orderBy(desc(schema.businessProfile.id))
        .limit(1);
      const row = rows[0];
      if (!row || !row.passwordHash) return { profile: null };
      const expected = await sessionTokenFor(row.email, row.passwordHash);
      if (expected !== args.sessionToken) return { profile: null };
      return { profile: await toProfile(ctx, row) };
    },
  }),

  saveProfile: defineAction({
    request: z.object({
      businessName: z.string().trim().max(80).default(""),
      niche: z.string().trim().min(1).max(60),
      nicheCustom: z.string().trim().max(60).default(""),
      email: z.union([emailString, z.literal("")]).default(""),
      // Senha da conta: obrigatória na criação (o cliente exige); ao
      // editar, enviar uma nova troca a senha, omitir mantém a atual.
      password: passwordString.optional(),
    }),
    response: z.object({
      ok: z.literal(true),
      sessionToken: z.string().nullable(),
    }),
    async handler(
      ctx,
      args,
    ): Promise<{ ok: true; sessionToken: string | null }> {
      const db = ctx.db<typeof schema>();
      const existing = await db
        .select({
          id: schema.businessProfile.id,
          trialEndsAt: schema.businessProfile.trialEndsAt,
          passwordHash: schema.businessProfile.passwordHash,
        })
        .from(schema.businessProfile)
        .orderBy(desc(schema.businessProfile.id))
        .limit(1);
      const now = Date.now();
      const first = existing[0];
      let finalHash = first?.passwordHash ?? "";
      if (args.password) {
        if (!args.email) {
          throw new Error("Informe o e-mail da conta para definir a senha.");
        }
        finalHash = await hashPassword(args.email, args.password);
      }
      if (first) {
        await db
          .update(schema.businessProfile)
          .set({
            businessName: args.businessName,
            niche: args.niche,
            nicheCustom: args.nicheCustom,
            email: args.email,
            passwordHash: finalHash,
            // Se a conta só tinha a logo (trial ainda não começou), os
            // 7 dias grátis começam agora, ao completar o cadastro.
            trialEndsAt:
              first.trialEndsAt > 0 ? first.trialEndsAt : now + TRIAL_MS,
            updatedAt: now,
          })
          .where(eq(schema.businessProfile.id, first.id));
      } else {
        // Conta nova: ganha 7 dias grátis a partir de agora.
        await db.insert(schema.businessProfile).values({
          businessName: args.businessName,
          niche: args.niche,
          nicheCustom: args.nicheCustom,
          email: args.email,
          passwordHash: finalHash,
          trialEndsAt: now + TRIAL_MS,
          updatedAt: now,
        });
      }
      ctx.invalidateQueries();
      return {
        ok: true,
        sessionToken:
          args.email && finalHash
            ? await sessionTokenFor(args.email, finalHash)
            : null,
      };
    },
  }),

  uploadLogo: defineAction({
    request: z.object({
      dataBase64: z.string().min(1).max(4_000_000),
      mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
    }),
    response: z.object({ logoUrl: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const bytes = Uint8Array.from(atob(args.dataBase64), (c) =>
        c.charCodeAt(0),
      );
      const ext =
        args.mimeType === "image/png"
          ? "png"
          : args.mimeType === "image/webp"
            ? "webp"
            : args.mimeType === "image/gif"
              ? "gif"
              : "jpg";
      const key = `account-logo/logo-${Date.now()}.${ext}`;
      await ctx.blobs.put(key, bytes, { contentType: args.mimeType });
      const existing = await db
        .select({ id: schema.businessProfile.id })
        .from(schema.businessProfile)
        .orderBy(desc(schema.businessProfile.id))
        .limit(1);
      const first = existing[0];
      if (first) {
        await db
          .update(schema.businessProfile)
          .set({ logoBlobKey: key, updatedAt: Date.now() })
          .where(eq(schema.businessProfile.id, first.id));
      } else {
        await db.insert(schema.businessProfile).values({
          logoBlobKey: key,
          updatedAt: Date.now(),
        });
      }
      ctx.invalidateQueries();
      return { logoUrl: await ctx.blobs.getUrl(key) };
    },
  }),

  removeLogo: defineAction({
    request: z.object({}),
    response: okResponse,
    async handler(ctx): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const existing = await db
        .select({ id: schema.businessProfile.id })
        .from(schema.businessProfile)
        .orderBy(desc(schema.businessProfile.id))
        .limit(1);
      const first = existing[0];
      if (first) {
        await db
          .update(schema.businessProfile)
          .set({ logoBlobKey: "", updatedAt: Date.now() })
          .where(eq(schema.businessProfile.id, first.id));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  listSales: defineAction({
    request: z.object({
      from: dateString.optional(),
      to: dateString.optional(),
    }),
    response: z.object({ sales: z.array(saleShape) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const conditions = [];
      if (args.from) conditions.push(gte(schema.sales.date, args.from));
      if (args.to) conditions.push(lte(schema.sales.date, args.to));
      const rows = await db
        .select()
        .from(schema.sales)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.sales.date), desc(schema.sales.id));
      return {
        sales: rows.map((row) => ({
          id: row.id,
          item: row.item,
          category: row.category,
          size: row.size,
          quantity: row.quantity,
          unitPriceCents: row.unitPriceCents,
          date: row.date,
          channel: row.channel,
          segment: normalizeSegment(row.segment as string),
          niche: row.niche,
          productId: row.productId ?? null,
        })),
      };
    },
  }),

  addSale: defineAction({
    request: z.object({
      item: z.string().trim().min(1).max(120),
      category: z.string().trim().max(60).default(""),
      size: z.string().trim().max(20).default(""),
      quantity: z.number().int().min(1).max(10000),
      unitPriceCents: z.number().int().min(0).max(100_000_000),
      date: dateString,
      channel: z.string().trim().min(1).max(40),
      segment: segmentEnum.default("gestao"),
      niche: z.string().trim().max(60).default(""),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const result = await db
        .insert(schema.sales)
        .values({
          item: args.item,
          category: args.category,
          size: args.size,
          quantity: args.quantity,
          unitPriceCents: args.unitPriceCents,
          date: args.date,
          channel: args.channel,
          segment: args.segment,
          niche: args.niche,
        })
        .returning({ id: schema.sales.id });
      const inserted = result[0];
      if (!inserted) {
        throw new Error("addSale: insert returned no rows");
      }
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  listProducts: defineAction({
    request: z.object({}),
    response: z.object({ products: z.array(productShape) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.products)
        .orderBy(desc(schema.products.id));
      return {
        products: rows.map((row) => ({
          id: row.id,
          niche: row.niche,
          name: row.name,
          category: row.category,
          variant: row.variant,
          priceCents: row.priceCents,
          stock: row.stock,
          resale: row.resale === 1,
        })),
      };
    },
  }),

  addProduct: defineAction({
    request: z.object({
      niche: z.string().trim().min(1).max(40),
      name: z.string().trim().min(1).max(120),
      category: z.string().trim().max(60).default(""),
      variant: z.string().trim().max(60).default(""),
      priceCents: z.number().int().min(0).max(100_000_000),
      stock: z.number().int().min(0).max(100000).default(0),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const result = await db
        .insert(schema.products)
        .values({
          niche: args.niche,
          name: args.name,
          category: args.category,
          variant: args.variant,
          priceCents: args.priceCents,
          stock: args.stock,
        })
        .returning({ id: schema.products.id });
      const inserted = result[0];
      if (!inserted) throw new Error("addProduct: insert returned no rows");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  updateProduct: defineAction({
    request: z.object({
      id: z.number().int().positive(),
      name: z.string().trim().min(1).max(120).optional(),
      category: z.string().trim().max(60).optional(),
      variant: z.string().trim().max(60).optional(),
      priceCents: z.number().int().min(0).max(100_000_000).optional(),
      stock: z.number().int().min(0).max(100000).optional(),
      resale: z.boolean().optional(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const patch: Partial<{
        name: string;
        category: string;
        variant: string;
        priceCents: number;
        stock: number;
        resale: number;
      }> = {};
      if (args.name !== undefined) patch.name = args.name;
      if (args.category !== undefined) patch.category = args.category;
      if (args.variant !== undefined) patch.variant = args.variant;
      if (args.priceCents !== undefined) patch.priceCents = args.priceCents;
      if (args.stock !== undefined) patch.stock = args.stock;
      if (args.resale !== undefined) patch.resale = args.resale ? 1 : 0;
      if (Object.keys(patch).length > 0) {
        await db
          .update(schema.products)
          .set(patch)
          .where(eq(schema.products.id, args.id));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteProduct: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.products).where(eq(schema.products.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // Venda pela seleção: escolhe o produto do estoque, sem digitar.
  // Grava a venda e baixa o estoque na mesma operação.
  sellProduct: defineAction({
    request: z.object({
      productId: z.number().int().positive(),
      quantity: z.number().int().min(1).max(10000),
      date: dateString,
      channel: z.string().trim().min(1).max(40),
      segment: segmentEnum.default("marketplace"),
    }),
    response: z.object({ id: z.number(), remainingStock: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, args.productId))
        .limit(1);
      const product = rows[0];
      if (!product) throw new Error("Produto não encontrado no estoque.");
      if (product.stock < args.quantity) {
        throw new Error(
          `Estoque insuficiente: restam ${product.stock} un. de ${product.name}.`,
        );
      }
      const remainingStock = product.stock - args.quantity;
      const inserted = await db
        .insert(schema.sales)
        .values({
          item: product.name,
          category: product.category,
          size: product.variant,
          quantity: args.quantity,
          unitPriceCents: product.priceCents,
          date: args.date,
          channel: args.channel,
          segment: args.segment,
          niche:
            args.segment === "marketplace"
              ? (PRODUCT_NICHE_LABELS[product.niche] ?? product.niche)
              : "",
          productId: product.id,
        })
        .returning({ id: schema.sales.id });
      const sale = inserted[0];
      if (!sale) throw new Error("sellProduct: insert returned no rows");
      await db
        .update(schema.products)
        .set({ stock: remainingStock })
        .where(eq(schema.products.id, product.id));
      ctx.invalidateQueries();
      return { id: sale.id, remainingStock };
    },
  }),

  // ---------- ADM: conta, período grátis, código de acesso ----------

  updateAccountEmail: defineAction({
    request: z.object({ email: emailString }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select({ id: schema.businessProfile.id })
        .from(schema.businessProfile)
        .orderBy(desc(schema.businessProfile.id))
        .limit(1);
      const first = rows[0];
      if (first) {
        await db
          .update(schema.businessProfile)
          .set({ email: args.email, updatedAt: Date.now() })
          .where(eq(schema.businessProfile.id, first.id));
      } else {
        await db.insert(schema.businessProfile).values({
          email: args.email,
          updatedAt: Date.now(),
        });
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  extendTrial: defineAction({
    request: z.object({ days: z.number().int().min(1).max(365) }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.businessProfile)
        .orderBy(desc(schema.businessProfile.id))
        .limit(1);
      const first = rows[0];
      if (first) {
        const base = Math.max(Date.now(), first.trialEndsAt);
        await db
          .update(schema.businessProfile)
          .set({
            trialEndsAt: base + args.days * 24 * 60 * 60 * 1000,
            updatedAt: Date.now(),
          })
          .where(eq(schema.businessProfile.id, first.id));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminStatus: defineAction({
    request: z.object({}),
    response: z.object({ hasCode: z.boolean() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "admin_code"))
        .limit(1);
      return { hasCode: Boolean(rows[0]?.value) };
    },
  }),

  setAdminCode: defineAction({
    request: z.object({ code: z.string().trim().min(4).max(40) }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "admin_code"))
        .limit(1);
      if (rows[0]?.value) {
        throw new Error("O código do ADM já foi definido.");
      }
      await db
        .insert(schema.appSettings)
        .values({ key: "admin_code", value: args.code });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  verifyAdminCode: defineAction({
    request: z.object({ code: z.string().trim().max(40) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "admin_code"))
        .limit(1);
      return { ok: Boolean(rows[0]?.value) && rows[0]?.value === args.code };
    },
  }),

  // ---------- pessoas: revendedores e vendedores ----------

  listMembers: defineAction({
    request: z.object({}),
    response: z.object({ members: z.array(memberShape) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.members)
        .orderBy(desc(schema.members.id));
      return {
        members: rows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          active: row.active === 1,
          createdAt: row.createdAt,
        })),
      };
    },
  }),

  addMember: defineAction({
    request: z.object({
      name: z.string().trim().min(1).max(80),
      email: emailString,
      role: z.enum(["revendedor", "vendedor"]).default("revendedor"),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const existing = await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(eq(schema.members.email, args.email))
        .limit(1);
      if (existing[0]) {
        throw new Error("Este e-mail já está cadastrado.");
      }
      const now = Date.now();
      const inserted = await db
        .insert(schema.members)
        .values({
          name: args.name,
          email: args.email,
          role: args.role,
          active: 1,
          createdAt: now,
        })
        .returning({ id: schema.members.id });
      const member = inserted[0];
      if (!member) throw new Error("addMember: insert returned no rows");
      // Avisa a dona no ADM (notificação com som no painel dela).
      await db.insert(schema.notifications).values({
        kind: "cadastro",
        message: `Novo ${args.role} cadastrado: ${args.name} (${args.email}).`,
        isRead: 0,
        createdAt: now,
      });
      ctx.invalidateQueries();
      return { id: member.id };
    },
  }),

  updateMember: defineAction({
    request: z.object({
      id: z.number().int().positive(),
      name: z.string().trim().min(1).max(80).optional(),
      email: emailString.optional(),
      role: z.enum(["revendedor", "vendedor"]).optional(),
      active: z.boolean().optional(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      if (args.email !== undefined) {
        const dup = await db
          .select({ id: schema.members.id })
          .from(schema.members)
          .where(eq(schema.members.email, args.email))
          .limit(1);
        const dupRow = dup[0];
        if (dupRow && dupRow.id !== args.id) {
          throw new Error("Este e-mail já está cadastrado para outra pessoa.");
        }
      }
      const patch: Partial<{
        name: string;
        email: string;
        role: "revendedor" | "vendedor";
        active: number;
      }> = {};
      if (args.name !== undefined) patch.name = args.name;
      if (args.email !== undefined) patch.email = args.email;
      if (args.role !== undefined) patch.role = args.role;
      if (args.active !== undefined) patch.active = args.active ? 1 : 0;
      if (Object.keys(patch).length > 0) {
        await db
          .update(schema.members)
          .set(patch)
          .where(eq(schema.members.id, args.id));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteMember: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.members).where(eq(schema.members.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // ---------- notificações do ADM ----------

  listNotifications: defineAction({
    request: z.object({}),
    response: z.object({ notifications: z.array(notificationShape) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.notifications)
        .orderBy(desc(schema.notifications.id))
        .limit(50);
      return {
        notifications: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          message: row.message,
          isRead: row.isRead === 1,
          createdAt: row.createdAt,
        })),
      };
    },
  }),

  markNotificationsRead: defineAction({
    request: z.object({}),
    response: okResponse,
    async handler(ctx): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.notifications)
        .set({ isRead: 1 })
        .where(eq(schema.notifications.isRead, 0));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  // ---------- aba Revenda: acesso por e-mail ----------

  resellerAccess: defineAction({
    request: z.object({ email: emailString }),
    response: z.object({
      member: memberShape.nullable(),
      catalog: z.array(productShape),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.members)
        .where(eq(schema.members.email, args.email))
        .limit(1);
      const row = rows[0];
      if (!row || row.role !== "revendedor" || row.active !== 1) {
        return { member: null, catalog: [] };
      }
      const products = await db
        .select()
        .from(schema.products)
        .where(eq(schema.products.resale, 1))
        .orderBy(desc(schema.products.id));
      return {
        member: {
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          active: row.active === 1,
          createdAt: row.createdAt,
        },
        catalog: products.map((p) => ({
          id: p.id,
          niche: p.niche,
          name: p.name,
          category: p.category,
          variant: p.variant,
          priceCents: p.priceCents,
          stock: p.stock,
          resale: p.resale === 1,
        })),
      };
    },
  }),

  deleteSale: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.sales).where(eq(schema.sales.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
} satisfies ActionsModule;
