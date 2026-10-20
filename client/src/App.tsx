import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim, fileToBase64 } from "@hatch/space-sdk/client";
import {
Bar,
BarChart,
CartesianGrid,
Cell,
ResponsiveContainer,
Tooltip,
XAxis,
YAxis,
} from "recharts";
import { api, type ApiResponse } from "./api";
import { playSaleSound } from "./saleSound";
import logoPingcou from "./assets/pingcou-venda-logo.png";
import pinguimTablet from "./assets/pinguim-tablet.jpg";
import pinguimBracos from "./assets/pinguim-bracos.jpg";
import pinguimJoinha from "./assets/pinguim-joinha.jpg";

type Sale = ApiResponse<typeof api, "listSales">["sales"][number];

// ---------- conta: período grátis de 7 dias ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trialInfo(profile: Profile): {
  hasTrial: boolean;
  expired: boolean;
  daysLeft: number;
} {
  const endsAt = profile?.trialEndsAt ?? 0;
  if (!endsAt) return { hasTrial: false, expired: false, daysLeft: 0 };
  const msLeft = endsAt - Date.now();
  return {
    hasTrial: true,
    expired: msLeft <= 0,
    daysLeft: Math.max(0, Math.ceil(msLeft / 86400000)),
  };
}

function formatDateTimeBR(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

type Profile = ApiResponse<typeof api, "getProfile">["profile"];

// ---------- constantes: a estratégia Pingou Venda ----------
//
// Gestão = frente das vendas locais, acompanhada no painel.
// Marketplace = vitrine para todos os nichos.
// A conta é criada já com um nicho: ele aparece no painel, no formulário
// de venda e em cada venda registrada.

type Segment = "gestao" | "marketplace";
type SegmentFilter = Segment | "todos";

const SEGMENTS: { key: Segment; label: string; short: string; tagline: string }[] = [
  {
    key: "gestao",
    label: "Gestão",
    short: "Gestão",
    tagline: "vendas locais",
  },
  {
    key: "marketplace",
    label: "Marketplace",
    short: "Marketplace",
    tagline: "todos os nichos",
  },
];

function segmentLabel(segment: string): string {
  return segment === "marketplace" ? "Marketplace" : "Gestão";
}

/** Nichos do Marketplace — a conta nasce com um deles. */
const NICHES: { key: string; label: string }[] = [
  { key: "vestuario", label: "Vestuário" },
  { key: "eletronicos", label: "Eletrônicos" },
  { key: "imports", label: "Imports" },
  { key: "outro", label: "Outro" },
];

// ---------- ecossistema de nichos ----------
//
// Cada nicho tem a sua página interna: seleção própria de categorias e
// variações, sugestões de produtos para montar o estoque em toques e o
// estoque da pessoa, que baixa sozinho a cada venda. Nada de digitar
// produto por produto: escolhe, toca, vendeu.

type NichePageData = {
  key: string;
  label: string;
  tagline: string;
  desc: string;
  categories: string[];
  variationLabel: string;
  variations: string[];
  starters: { name: string; category: string }[];
};

const NICHE_PAGES: NichePageData[] = [
  {
    key: "vestuario",
    label: "Vestuário",
    tagline: "Moda com tamanho certo",
    desc: "Peças com categoria e tamanho prontos para tocar: monte o estoque da sua loja uma vez e venda sem digitar.",
    categories: [
      "Vestido",
      "Blusa",
      "Camiseta",
      "Calça",
      "Saia",
      "Shorts",
      "Conjunto",
      "Jaqueta / Casaco",
      "Macacão",
      "Calçados",
      "Acessórios",
    ],
    variationLabel: "Tamanho",
    variations: ["PP", "P", "M", "G", "GG", "34", "36", "38", "40", "42", "44", "Único"],
    starters: [
      { name: "Vestido midi floral", category: "Vestido" },
      { name: "Blusa de tricô", category: "Blusa" },
      { name: "Camiseta básica", category: "Camiseta" },
      { name: "Calça jeans wide leg", category: "Calça" },
      { name: "Conjunto alfaiataria", category: "Conjunto" },
      { name: "Jaqueta jeans", category: "Jaqueta / Casaco" },
      { name: "Saia plissada", category: "Saia" },
      { name: "Shorts jeans", category: "Shorts" },
    ],
  },
  {
    key: "eletronicos",
    label: "Eletrônicos",
    tagline: "Gadget com modelo certo",
    desc: "Aparelhos e acessórios com modelo e cor na seleção: estoque contado unidade por unidade, sem ficha solta.",
    categories: [
      "Celular",
      "Fone de ouvido",
      "Caixa de som",
      "Smartwatch",
      "Carregador e cabos",
      "Informática",
      "Games",
      "Casa inteligente",
      "Acessórios",
    ],
    variationLabel: "Modelo / cor",
    variations: ["Preto", "Branco", "Azul", "Cinza", "128 GB", "256 GB", "Único"],
    starters: [
      { name: "Fone de ouvido bluetooth", category: "Fone de ouvido" },
      { name: "Caixa de som portátil", category: "Caixa de som" },
      { name: "Smartwatch", category: "Smartwatch" },
      { name: "Carregador turbo USB-C", category: "Carregador e cabos" },
      { name: "Cabo USB-C trançado", category: "Carregador e cabos" },
      { name: "Suporte de celular", category: "Acessórios" },
      { name: "Mouse sem fio", category: "Informática" },
      { name: "Luminária smart", category: "Casa inteligente" },
    ],
  },
  {
    key: "imports",
    label: "Imports",
    tagline: "Importado com origem certa",
    desc: "Perfumes, relógios e bolsas de fora com variação pronta: seu estoque de importados organizado por toque.",
    categories: [
      "Perfume importado",
      "Relógio",
      "Bolsa importada",
      "Óculos",
      "Cosmético importado",
      "Eletrônico importado",
      "Acessório importado",
    ],
    variationLabel: "Variação",
    variations: ["Original", "50 ml", "100 ml", "Preto", "Dourado", "Prata", "Único"],
    starters: [
      { name: "Perfume importado 100 ml", category: "Perfume importado" },
      { name: "Relógio importado", category: "Relógio" },
      { name: "Bolsa transversal importada", category: "Bolsa importada" },
      { name: "Óculos de sol importado", category: "Óculos" },
      { name: "Creme importado", category: "Cosmético importado" },
      { name: "Fone importado", category: "Eletrônico importado" },
    ],
  },
];

function nichePageOf(key: string): NichePageData | undefined {
  return NICHE_PAGES.find((n) => n.key === key);
}

function nicheLabelOf(niche: string, nicheCustom: string): string {
  if (niche === "outro") return nicheCustom.trim() || "Outro nicho";
  return NICHES.find((n) => n.key === niche)?.label ?? niche;
}

const CHANNELS_GESTAO = [
  "Venda local",
  "WhatsApp",
  "Instagram",
  "Feira",
  "Entrega local",
  "Outro",
];
const CHANNELS_MARKETPLACE = [
  "Marketplace",
  "WhatsApp",
  "Instagram",
  "Loja online",
  "Outro",
];

function channelsFor(segment: Segment): string[] {
  return segment === "marketplace" ? CHANNELS_MARKETPLACE : CHANNELS_GESTAO;
}

const CHART_COLORS = [
  "#9d4edd",
  "#c77dff",
  "#e0aaff",
  "#7b2ff7",
  "#a100f2",
  "#5a189a",
  "#b517f5",
  "#3c096c",
];

const MONTHS_SHORT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

type PeriodKey = "hoje" | "7d" | "30d" | "mes" | "tudo" | "custom";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "mes", label: "Este mês" },
  { key: "tudo", label: "Tudo" },
  { key: "custom", label: "Período…" },
];

// ---------- datas e dinheiro ----------

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function todayISO(): string {
  return toISODate(new Date());
}

function parseISO(iso: string): Date {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

function formatDateBR(iso: string): string {
  const [y = "", m = "", d = ""] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatDayShort(iso: string): string {
  const [, m = "", d = ""] = iso.split("-");
  return `${d}/${m}`;
}

function monthLabel(monthKey: string): string {
  const [y = "", m = "1"] = monthKey.split("-");
  const name = MONTHS_SHORT[Number(m) - 1] ?? "";
  return `${name}/${y.slice(2)}`;
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatBRL(cents: number): string {
  return brl.format(cents / 100);
}

/** Aceita "79,90", "79.90", "1.299,90", "R$ 79,90" → centavos inteiros. */
function parsePriceToCents(raw: string): number | null {
  const cleaned = raw.replace(/[R$\s]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

function periodRange(
  key: PeriodKey,
  customFrom: string,
  customTo: string,
): { from?: string; to?: string } {
  const today = todayISO();
  switch (key) {
    case "hoje":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "mes":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "tudo":
      return {};
    case "custom":
      return {
        from: customFrom || undefined,
        to: customTo || undefined,
      };
  }
}

function periodCaption(key: PeriodKey, range: { from?: string; to?: string }): string {
  switch (key) {
    case "hoje":
      return "faturamento de hoje";
    case "7d":
      return "faturamento dos últimos 7 dias";
    case "30d":
      return "faturamento dos últimos 30 dias";
    case "mes":
      return "faturamento deste mês";
    case "tudo":
      return "faturamento de todo o período";
    case "custom":
      if (range.from && range.to)
        return `de ${formatDateBR(range.from)} a ${formatDateBR(range.to)}`;
      if (range.from) return `desde ${formatDateBR(range.from)}`;
      if (range.to) return `até ${formatDateBR(range.to)}`;
      return "escolha as datas do período";
  }
}

// ---------- agregações ----------

function saleTotal(s: Sale): number {
  return s.quantity * s.unitPriceCents;
}

type DayPoint = { label: string; total: number };

function buildSeries(sales: Sale[], range: { from?: string; to?: string }): DayPoint[] {
  const byDay = new Map<string, number>();
  const byMonth = new Map<string, number>();
  for (const s of sales) {
    byDay.set(s.date, (byDay.get(s.date) ?? 0) + saleTotal(s));
    const mk = s.date.slice(0, 7);
    byMonth.set(mk, (byMonth.get(mk) ?? 0) + saleTotal(s));
  }
  if (range.from && range.to) {
    const days =
      Math.round(
        (parseISO(range.to).getTime() - parseISO(range.from).getTime()) / 86400000,
      ) + 1;
    if (days >= 1 && days <= 92) {
      const out: DayPoint[] = [];
      for (let i = 0; i < days; i++) {
        const iso = addDays(range.from, i);
        out.push({ label: formatDayShort(iso), total: byDay.get(iso) ?? 0 });
      }
      return out;
    }
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mk, total]) => ({ label: monthLabel(mk), total }));
}

type GroupTotal = { name: string; total: number; pieces: number };

function groupTotals(sales: Sale[], pick: (s: Sale) => string): GroupTotal[] {
  const map = new Map<string, GroupTotal>();
  for (const s of sales) {
    const name = pick(s);
    const cur = map.get(name) ?? { name, total: 0, pieces: 0 };
    cur.total += saleTotal(s);
    cur.pieces += s.quantity;
    map.set(name, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function scrollToId(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function goConta() {
  // Criar conta / dados da conta vivem na PÁGINA DE ACESSO (#/auth) — a
  // página pública não tem formulário de cadastro embutido. Quem pede a
  // conta (ex.: o botão "Editar conta" do painel) abre a página de
  // acesso por este evento, que o App escuta e transforma em
  // openAuth("conta").
  window.dispatchEvent(
    new CustomEvent("pingcou:open-auth", { detail: "conta" }),
  );
}

// ---------- ícones (SVG inline) ----------

function IconCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M4.5 12.5l5 5L19.5 7" />
    </svg>
  );
}

function IconSpark({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2z" />
      <path d="M19 15.5l.8 2.7 2.7.8-2.7.8L19 22.5l-.8-2.7-2.7-.8 2.7-.8L19 15.5z" />
    </svg>
  );
}

/** Selo em pílula pequena com ícone dourado, no topo de cada seção. */
function PillBadge({ children }: { children: ReactNode }) {
  return (
    <span className="pill-badge">
      <span className="pill-icon">
        <IconSpark />
      </span>
      {children}
    </span>
  );
}

function IconX() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      className="mt-0.5 h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

// ---------- avatar do pinguim: flutua, balança e troca de pose ----------

const PENGUIN_POSES: { src: string; alt: string }[] = [
  {
    src: pinguimTablet,
    alt: "Pinguim de terno roxo e óculos segurando um tablet com o gráfico de vendas da Pingou Venda",
  },
  {
    src: pinguimBracos,
    alt: "Pinguim de terno roxo e óculos de braços cruzados, cercado por cartões de vendas e conversão",
  },
  {
    src: pinguimJoinha,
    alt: "Pinguim de terno roxo e óculos fazendo sinal de positivo e segurando um tablet",
  },
];

/**
 * Avatar animado do pinguim da Pingou Venda: flutua para cima e para baixo,
 * balança de leve e alterna entre as três poses com transição suave.
 * Quem prefere menos movimento (prefers-reduced-motion) vê a primeira pose
 * parada, sem flutuar nem trocar.
 */
function PenguinMascot({ eager = false }: { eager?: boolean }) {
  const [pose, setPose] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(
      () => setPose((p) => (p + 1) % PENGUIN_POSES.length),
      2600,
    );
    return () => window.clearInterval(id);
  }, []);

  const active = PENGUIN_POSES[pose] ?? PENGUIN_POSES[0];

  return (
    <figure className="penguin-float mx-auto w-full max-w-[400px]">
      <div className="penguin-sway card-glow relative aspect-[4/5] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface)]">
        {PENGUIN_POSES.map((p, i) => (
          <img
            key={p.src}
            src={p.src}
            alt={i === pose ? p.alt : ""}
            aria-hidden={i !== pose}
            loading={eager ? "eager" : "lazy"}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
              i === pose ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
      </div>
      <figcaption className="sr-only">{active?.alt}</figcaption>
    </figure>
  );
}

// ---------- entrar com e-mail e senha: login da conta ----------
//
// A sessão (e-mail + token) fica SALVA neste aparelho (localStorage):
// quem já entrou não digita a senha de novo ao reabrir o app — o token é
// revalidado com o servidor (checkSession) e o painel abre direto, já no
// nicho da conta. "Sair" apaga a sessão salva.

const LOGIN_SESSION_KEY = "pingcou:login-session";

// ---------- entrar / criar conta com Google (OAuth) ----------
//
// Usa o Google Identity Services (conta Google de verdade, com a janela
// oficial do Google). O Client ID é do projeto Google da Pingou Venda e
// fica guardado no app (ADM > Login com Google). Sem Client ID salvo, o
// botão explica o que falta em vez de fingir um login.

type GoogleIdentity = { email: string; name: string; sub: string };

type GoogleIdApi = {
  accounts: {
    id: {
      initialize: (cfg: {
        client_id: string;
        callback: (r: { credential?: string }) => void;
      }) => void;
      prompt: () => void;
    };
  };
};

function googleApi(): GoogleIdApi | undefined {
  return (window as unknown as { google?: GoogleIdApi }).google;
}

let gisLoad: Promise<void> | null = null;
function loadGoogleScript(): Promise<void> {
  if (googleApi()) return Promise.resolve();
  if (!gisLoad) {
    gisLoad = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("gis"));
      document.head.appendChild(s);
    });
  }
  return gisLoad;
}

/** Lê e-mail, nome e sub do ID token (JWT) devolvido pelo Google. */
function decodeGoogleCredential(credential: string): GoogleIdentity | null {
  try {
    const part = credential.split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""),
    );
    const payload = JSON.parse(json) as {
      email?: string;
      name?: string;
      sub?: string;
    };
    if (!payload.email || !payload.sub) return null;
    return {
      email: payload.email.toLowerCase(),
      name: payload.name ?? "",
      sub: payload.sub,
    };
  } catch {
    return null;
  }
}

function GoogleAuthButton({
  mode,
  businessName = "",
  niche = "",
  nicheCustom = "",
  validate,
  onDone,
  variant,
}: {
  mode: "login" | "create";
  businessName?: string;
  niche?: string;
  nicheCustom?: string;
  validate?: () => string | null;
  onDone: (email: string, token: string) => void;
  /** "auth": botão escuro da página de acesso, com o rótulo "Google". */
  variant?: "auth";
}) {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: ["google-config"],
    queryFn: () => api.googleConfig({}),
  });
  const clientId = configQuery.data?.clientId ?? "";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const auth = useMutation({
    mutationFn: api.authWithGoogle,
    onSuccess: (data, variables) => {
      setBusy(false);
      if (data.sessionToken && data.profile) {
        queryClient.invalidateQueries({ queryKey: ["profile"] });
        queryClient.invalidateQueries({ queryKey: ["session"] });
        onDone(variables.email, data.sessionToken);
      } else {
        setError(
          "Não encontrei nenhuma conta com esse Google. Crie sua conta em “Criar conta com Google”.",
        );
      }
    },
    onError: () => {
      setBusy(false);
      setError("Não consegui entrar com o Google agora. Tente de novo.");
    },
  });

  async function handleClick() {
    setError("");
    const problem = validate?.();
    if (problem) {
      setError(problem);
      return;
    }
    if (!clientId) {
      setError(
        "O login com Google ainda não foi ativado neste app. Enquanto isso, entre com e-mail e senha.",
      );
      return;
    }
    setBusy(true);
    try {
      await loadGoogleScript();
      const google = googleApi();
      if (!google) throw new Error("gis");
      google.accounts.id.initialize({
        client_id: clientId,
        callback: (res) => {
          const credential = res.credential ?? "";
          const identity = credential
            ? decodeGoogleCredential(credential)
            : null;
          if (!identity) {
            setBusy(false);
            setError("O Google não confirmou sua conta. Tente de novo.");
            return;
          }
          auth.mutate({
            idToken: credential,
            email: identity.email,
            name: identity.name,
            sub: identity.sub,
            mode,
            businessName,
            niche,
            nicheCustom,
          });
        },
      });
      google.accounts.id.prompt();
      // A janela do Google é assíncrona; se a pessoa fechar sem escolher,
      // o busy é liberado pelo callback/erro — e por este respiro:
      window.setTimeout(() => setBusy(false), 4000);
    } catch {
      setBusy(false);
      setError("Não consegui abrir o Google agora. Tente de novo.");
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || auth.isPending}
        aria-label={
          mode === "login" ? "Entrar com Google" : "Criar conta com Google"
        }
        className={
          variant === "auth"
            ? "flex w-full items-center justify-center gap-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 text-base font-semibold text-[var(--text)] disabled:opacity-60"
            : "flex w-full items-center justify-center gap-3 rounded-full border border-[var(--border)] bg-white px-4 py-3 text-base font-semibold text-[#1f1f1f] disabled:opacity-60"
        }
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.3h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.2 3.7-8.8z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.8-5l-3.9 3C3.3 21.3 7.3 24 12 24z"
          />
          <path
            fill="#FBBC05"
            d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4l-3.9-3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l3.9-3z"
          />
          <path
            fill="#EA4335"
            d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.3 0 3.3 2.7 1.3 6.6l3.9 3c.9-2.8 3.6-4.9 6.8-4.9z"
          />
        </svg>
        {busy || auth.isPending
          ? "Abrindo o Google…"
          : variant === "auth"
            ? "Google"
            : mode === "login"
              ? "Entrar com Google"
              : "Criar conta com Google"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

/** Conta Google já confirmada, aguardando os dados da empresa (passo 2). */
type GooglePending = GoogleIdentity & { idToken: string };

function GoogleLogoSvg() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.3h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.2 3.7-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.8-5l-3.9 3C3.3 21.3 7.3 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4l-3.9-3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l3.9-3z"
      />
      <path
        fill="#EA4335"
        d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.3 0 3.3 2.7 1.3 6.6l3.9 3c.9-2.8 3.6-4.9 6.8-4.9z"
      />
    </svg>
  );
}

// ---------- criar conta com Google: PASSO 1 é o login Google ----------
//
// NENHUM dado da empresa é pedido antes: o botão vem primeiro, sozinho.
// Ao clicar, abre a janela oficial do Google. Só DEPOIS de a conta Google
// ser confirmada é que o app pede nome da empresa, nicho etc. (passo 2,
// no OnboardingCard). Se esse Google já tiver conta, entra direto.

function GoogleSignupStartButton({
  onExisting,
  onNeedsProfile,
}: {
  onExisting: (email: string, token: string) => void;
  onNeedsProfile: (pending: GooglePending) => void;
}) {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: ["google-config"],
    queryFn: () => api.googleConfig({}),
  });
  const clientId = configQuery.data?.clientId ?? "";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef<GooglePending | null>(null);

  const probe = useMutation({
    mutationFn: api.authWithGoogle,
    onSuccess: (data, variables) => {
      setBusy(false);
      if (data.sessionToken && data.profile) {
        // Esse Google já tem conta: entra direto, sem passo 2.
        queryClient.invalidateQueries({ queryKey: ["profile"] });
        queryClient.invalidateQueries({ queryKey: ["session"] });
        onExisting(variables.email, data.sessionToken);
        return;
      }
      // Conta nova: o Google foi confirmado — agora sim o app pede os
      // dados da empresa (passo 2).
      const pending = pendingRef.current;
      if (pending) {
        onNeedsProfile(pending);
      } else {
        setError("O Google não confirmou sua conta. Tente de novo.");
      }
    },
    onError: () => {
      setBusy(false);
      setError("Não consegui entrar com o Google agora. Tente de novo.");
    },
  });

  async function handleClick() {
    setError("");
    if (!clientId) {
      setError(
        "O login com Google ainda não foi ativado neste app. Enquanto isso, crie sua conta com e-mail e senha abaixo.",
      );
      return;
    }
    setBusy(true);
    try {
      await loadGoogleScript();
      const google = googleApi();
      if (!google) throw new Error("gis");
      google.accounts.id.initialize({
        client_id: clientId,
        callback: (res) => {
          const credential = res.credential ?? "";
          const identity = credential
            ? decodeGoogleCredential(credential)
            : null;
          if (!identity) {
            setBusy(false);
            setError("O Google não confirmou sua conta. Tente de novo.");
            return;
          }
          pendingRef.current = { ...identity, idToken: credential };
          // Confere no servidor se esse Google já tem conta (mode login
          // NÃO cria nada: só entra quem já existe).
          probe.mutate({
            idToken: credential,
            email: identity.email,
            name: identity.name,
            sub: identity.sub,
            mode: "login",
            businessName: "",
            niche: "",
            nicheCustom: "",
          });
        },
      });
      google.accounts.id.prompt();
      window.setTimeout(() => setBusy(false), 4000);
    } catch {
      setBusy(false);
      setError("Não consegui abrir o Google agora. Tente de novo.");
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || probe.isPending}
        aria-label="Criar conta com Google"
        className="flex w-full items-center justify-center gap-3 rounded-full border border-[var(--border)] bg-white px-4 py-3 text-base font-semibold text-[#1f1f1f] disabled:opacity-60"
      >
        <GoogleLogoSvg />
        {busy || probe.isPending
          ? "Abrindo o Google…"
          : "Criar conta com Google"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

type LoginSession = { email: string; token: string };

// ---------- página de acesso (#/auth): entrar, na lógica do VendaMax ----------
//
// Página dedicada e limpa, separada da página pública: logo no topo,
// "Bem-vindo de volta!", e-mail e senha (com olhinho), "Lembrar acesso",
// "Esqueceu sua senha?", botão grande Entrar, separador "ou continue
// com", botão Google, link para o cadastro e o link "Conhecer o Pingou
// Venda →" de volta para a página pública/demonstração. Tema roxo da
// Pingou Venda — nada de verde.

function IconMail() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

function IconEye({ off = false }: { off?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

function AuthLoginForm({
  onLogin,
}: {
  onLogin: (email: string, token: string, remember: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [showForgot, setShowForgot] = useState(false);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [wrongPassword, setWrongPassword] = useState(false);

  const login = useMutation({
    mutationFn: api.loginWithEmail,
    onSuccess: (data, variables) => {
      if (data.found && data.passwordOk && data.sessionToken) {
        setError("");
        setNotFound(false);
        setWrongPassword(false);
        onLogin(variables.email, data.sessionToken, remember);
      } else if (data.found) {
        setWrongPassword(true);
      } else {
        setNotFound(true);
      }
    },
    onError: () => setError("Não consegui entrar agora. Tente de novo."),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) {
      setError("Informe um e-mail válido — Gmail ou qualquer outro e-mail.");
      return;
    }
    if (password.length < 4) {
      setError("Informe a senha da sua conta (4+ caracteres).");
      return;
    }
    setError("");
    setNotFound(false);
    setWrongPassword(false);
    login.mutate({ email: value, password });
  }

  const inputCls =
    "w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] py-3.5 pl-11 pr-4 text-base text-[var(--text)] outline-none focus:border-[var(--accent)]";
  const labelCls = "mb-1.5 block text-base font-semibold text-[var(--text)]";

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="auth-email" className={labelCls}>
            E-mail
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--dim)]">
              <IconMail />
            </span>
            <input
              id="auth-email"
              className={inputCls}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              autoComplete="email"
            />
          </div>
        </div>
        <div className="mt-5">
          <label htmlFor="auth-password" className={labelCls}>
            Senha
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--dim)]">
              <IconLock />
            </span>
            <input
              id="auth-password"
              className={`${inputCls} pr-12`}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Sua senha"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={showPassword}
              className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-[var(--dim)]"
            >
              <IconEye off={showPassword} />
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label
            htmlFor="auth-remember"
            className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-[var(--text)]"
          >
            <input
              id="auth-remember"
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-5 w-5 shrink-0"
              style={{ accentColor: "var(--accent)" }}
            />
            Lembrar acesso
          </label>
          <button
            type="button"
            onClick={() => setShowForgot((v) => !v)}
            aria-expanded={showForgot}
            className="text-sm font-semibold text-[var(--accent-2)]"
          >
            Esqueceu sua senha?
          </button>
        </div>
        {showForgot && (
          <p role="status" className="mt-3 text-sm leading-relaxed text-[var(--dim)]">
            Esqueceu a senha? Chama a Pingou Venda no Instagram{" "}
            <a
              href="https://www.instagram.com/pingoouvenda/"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-[var(--accent-2)] underline"
            >
              @pingoouvenda
            </a>{" "}
            que a gente confirma seus dados e te ajuda a voltar para a sua
            conta.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
        {notFound && (
          <p role="alert" className="mt-4 text-sm text-[var(--danger)]">
            Não encontrei nenhuma conta com esse e-mail. Confira o e-mail
            digitado ou cadastre-se abaixo.
          </p>
        )}
        {wrongPassword && (
          <p role="alert" className="mt-4 text-sm text-[var(--danger)]">
            Senha incorreta para esse e-mail. Confira a senha digitada e
            tente de novo.
          </p>
        )}

        <button
          type="submit"
          disabled={login.isPending}
          className="btn-glow mt-6 w-full rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-4 text-lg font-bold text-[var(--accent-ink)] disabled:opacity-60"
        >
          {login.isPending ? "Entrando…" : "Entrar"}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-sm text-[var(--dim)]">ou continue com</span>
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>
      <GoogleAuthButton
        mode="login"
        variant="auth"
        onDone={(googleEmail, token) => onLogin(googleEmail, token, remember)}
      />
    </div>
  );
}

/**
 * A página de acesso em si (#/auth): entrar ou criar conta, sem TopNav,
 * sem demonstração e sem painel — só o acesso. Entrar com sucesso (ou
 * criar a conta) leva direto para a página do painel.
 */
function AuthPage({
  mode,
  onModeChange,
  profile,
  onLogin,
  onAccountCreated,
  onLogout,
  onGoPanel,
  onGoHome,
}: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  profile: Profile;
  onLogin: (email: string, token: string, remember: boolean) => void;
  onAccountCreated: (
    email: string,
    token: string | null,
    wasCreation: boolean,
  ) => void;
  onLogout: () => void;
  onGoPanel: () => void;
  onGoHome: () => void;
}) {
  const trial = profile ? trialInfo(profile) : null;
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-12 sm:pt-16">
      <div className="text-center">
        <img
          src={logoPingcou}
          alt="Pingou Venda"
          className="mx-auto w-[210px] max-w-[70vw]"
        />
      </div>

      {profile ? (
        <div className="mt-10">
          <h1 className="text-3xl font-extrabold tracking-tight text-[var(--text)]">
            Você entrou!
            {profile.businessName ? ` ${profile.businessName}` : ""}
          </h1>
          <p className="mt-2 text-base text-[var(--dim)]">
            {profile.email} · Nicho:{" "}
            {nicheLabelOf(profile.niche, profile.nicheCustom)}
          </p>
          {trial?.hasTrial && (
            <p className="mt-2 text-sm text-[var(--dim)]">
              {trial.expired
                ? "Seu período grátis de 7 dias acabou. Fale com a Pingou Venda para reativar sua conta."
                : `Período grátis até ${formatDateTimeBR(profile.trialEndsAt)} — ${trial.daysLeft} ${trial.daysLeft === 1 ? "dia restante" : "dias restantes"}.`}
            </p>
          )}
          <button
            type="button"
            onClick={onGoPanel}
            className="btn-glow mt-6 w-full rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-4 text-lg font-bold text-[var(--accent-ink)]"
          >
            Ir para o meu painel
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="mt-3 w-full rounded-[var(--radius-sm)] border border-[var(--border)] px-4 py-3.5 text-base font-semibold text-[var(--text)]"
          >
            Sair
          </button>
        </div>
      ) : mode === "entrar" ? (
        <div className="mt-10">
          <h1 className="text-4xl font-extrabold tracking-tight text-[var(--text)]">
            Bem-vindo de volta!
          </h1>
          <p className="mt-2 text-base text-[var(--dim)]">
            Faça login para continuar
          </p>
          <div className="mt-8">
            <AuthLoginForm onLogin={onLogin} />
          </div>
          <p className="mt-8 text-center text-base text-[var(--dim)]">
            Ainda não tem uma conta?{" "}
            <button
              type="button"
              onClick={() => onModeChange("conta")}
              className="font-bold text-[var(--accent-2)]"
            >
              Cadastre-se
            </button>
          </p>
        </div>
      ) : (
        <div className="mt-10">
          <h1 className="text-4xl font-extrabold tracking-tight text-[var(--text)]">
            Crie sua conta
          </h1>
          <p className="mt-2 text-base text-[var(--dim)]">
            Comece agora com 7 dias grátis — o painel já abre no seu nicho.
          </p>
          <div className="mt-8">
            <OnboardingCard idPrefix="auth-" onAccountSaved={onAccountCreated} />
          </div>
          <p className="mt-8 text-center text-base text-[var(--dim)]">
            Já tem uma conta?{" "}
            <button
              type="button"
              onClick={() => onModeChange("entrar")}
              className="font-bold text-[var(--accent-2)]"
            >
              Entrar
            </button>
          </p>
        </div>
      )}

      <div className="mt-10 text-center">
        <button
          type="button"
          onClick={onGoHome}
          className="text-base font-semibold text-[var(--accent-2)]"
        >
          Conhecer o Pingou Venda →
        </button>
      </div>
    </main>
  );
}


// ---------- criação de conta: o nicho aparece já no cadastro ----------

function OnboardingCard({
  onAccountSaved,
  idPrefix = "",
}: {
  onAccountSaved?: (
    email: string,
    token: string | null,
    wasCreation: boolean,
  ) => void;
  idPrefix?: string;
}) {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.getProfile({}),
  });
  const profile = profileQuery.data?.profile ?? null;

  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [niche, setNiche] = useState("");
  const [nicheCustom, setNicheCustom] = useState("");
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const hydrated = useRef(false);
  const creatingRef = useRef(false);

  // Criar conta com Google em DOIS passos: 1º o login Google (botão no
  // topo, sem pedir nada antes); 2º, com o Google já confirmado, este
  // estado guarda a identidade e o formulário pede os dados da empresa.
  const [googlePending, setGooglePending] = useState<GooglePending | null>(
    null,
  );
  const [googleError, setGoogleError] = useState("");

  const completeGoogle = useMutation({
    mutationFn: api.authWithGoogle,
    onSuccess: (data, variables) => {
      if (data.sessionToken && data.profile) {
        queryClient.invalidateQueries({ queryKey: ["profile"] });
        queryClient.invalidateQueries({ queryKey: ["session"] });
        setGoogleError("");
        setGooglePending(null);
        onAccountSaved?.(variables.email, data.sessionToken, true);
      } else {
        setGoogleError(
          "Não consegui concluir o cadastro com o Google. Tente de novo.",
        );
      }
    },
    onError: () =>
      setGoogleError("Não consegui concluir o cadastro. Tente de novo."),
  });

  function handleGoogleComplete(e: FormEvent) {
    e.preventDefault();
    if (!googlePending) return;
    if (!businessName.trim()) {
      setGoogleError("Informe o nome da empresa para concluir o cadastro.");
      return;
    }
    if (!niche) {
      setGoogleError("Escolha o nicho do seu negócio para concluir.");
      return;
    }
    if (niche === "outro" && !nicheCustom.trim()) {
      setGoogleError("Escreva o seu nicho no campo de “Outro”.");
      return;
    }
    setGoogleError("");
    completeGoogle.mutate({
      idToken: googlePending.idToken,
      email: googlePending.email,
      name: googlePending.name,
      sub: googlePending.sub,
      mode: "create",
      businessName: businessName.trim(),
      niche,
      nicheCustom: niche === "outro" ? nicheCustom.trim() : "",
    });
  }

  // Preenche o formulário com a conta salva — uma vez, sem apagar o que
  // a pessoa estiver digitando depois.
  useEffect(() => {
    if (hydrated.current) return;
    if (profileQuery.isPending) return;
    hydrated.current = true;
    if (profile) {
      setBusinessName(profile.businessName);
      setEmail(profile.email);
      setNiche(profile.niche);
      setNicheCustom(profile.nicheCustom);
    }
  }, [profileQuery.isPending, profile]);

  const [logoError, setLogoError] = useState("");
  const uploadLogo = useMutation({
    mutationFn: api.uploadLogo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setLogoError("");
    },
    onError: () =>
      setLogoError("Não consegui enviar a logo. Tente outra imagem."),
  });
  const removeLogo = useMutation({
    mutationFn: api.removeLogo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });

  async function handleLogoFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setLogoError("Escolha um arquivo de imagem (PNG, JPG ou WebP).");
      return;
    }
    if (file.size > 2_500_000) {
      setLogoError("A logo é muito grande — escolha uma imagem de até 2,5 MB.");
      return;
    }
    try {
      const encoded = await fileToBase64(file);
      const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
      const mimeType = (
        allowed.includes(encoded.mimeType)
          ? encoded.mimeType
          : allowed.includes(file.type)
            ? file.type
            : "image/jpeg"
      ) as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
      if (!encoded.dataBase64) throw new Error("empty");
      uploadLogo.mutate({ dataBase64: encoded.dataBase64, mimeType });
    } catch {
      setLogoError("Não consegui ler essa imagem. Tente outra.");
    }
  }

  const saveProfile = useMutation({
    mutationFn: api.saveProfile,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setError("");
      const savedEmail = email.trim().toLowerCase();
      // Criar a conta já entra automaticamente: o token de sessão volta
      // junto do salvamento e a sessão é aberta na hora, sem precisar
      // fazer login depois. Quem chamou decide a navegação (painel).
      if (savedEmail)
        onAccountSaved?.(savedEmail, data.sessionToken, creatingRef.current);
      setSavedMsg(
        creatingRef.current
          ? "Conta criada! Você já entrou automaticamente — bem-vinda ao seu painel. Você ganhou 7 dias grátis e o painel já está no seu nicho."
          : "Conta salva! Seu nicho já aparece no painel e nas suas próximas vendas.",
      );
    },
    onError: () => setError("Não consegui salvar a conta. Tente de novo."),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!businessName.trim()) {
      setError("Informe o nome da empresa para continuar.");
      return;
    }
    if (!niche) {
      setError("Escolha o nicho do seu negócio para continuar.");
      return;
    }
    if (niche === "outro" && !nicheCustom.trim()) {
      setError("Escreva o seu nicho no campo ao lado de “Outro”.");
      return;
    }
    if (!profile && !EMAIL_RE.test(email.trim())) {
      setError(
        "Informe um e-mail válido: é com ele que sua conta é identificada.",
      );
      return;
    }
    if (email.trim() && !EMAIL_RE.test(email.trim())) {
      setError("Esse e-mail não parece válido — confere e tenta de novo.");
      return;
    }
    if (!profile && password.length < 4) {
      setError("Crie uma senha com 4+ caracteres: é com e-mail e senha que você entra na conta.");
      return;
    }
    if (password && password.length < 4) {
      setError("A nova senha precisa de 4+ caracteres — ou deixe o campo vazio para manter a atual.");
      return;
    }
    creatingRef.current = !profile;
    setSavedMsg("");
    saveProfile.mutate({
      businessName: businessName.trim(),
      niche,
      nicheCustom: niche === "outro" ? nicheCustom.trim() : "",
      email: email.trim().toLowerCase(),
      ...(password ? { password } : {}),
    });
  }

  const inputCls =
    "w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-base text-[var(--text)] outline-none focus:border-[var(--accent)]";
  const labelCls = "mb-1 block text-sm font-medium text-[var(--text)]";

  // PASSO 2 do cadastro com Google: o login Google já foi feito — só
  // agora o app pede os dados da empresa (nome, nicho). Sem e-mail/senha:
  // a conta é a do Google confirmado no passo 1.
  if (googlePending && !profile) {
    return (
      <form
        onSubmit={handleGoogleComplete}
        className="card-glow rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6"
      >
        <h3 className="text-2xl font-extrabold tracking-tight text-[var(--text)]">
          Google conectado! Agora, os dados da sua empresa
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
          Você entrou com <strong>{googlePending.email}</strong>. Para
          terminar de criar sua conta, informe o nome da empresa e o nicho —
          o painel já abre no seu nicho e você entra automaticamente.
        </p>
        <div className="mt-5">
          <label htmlFor={`${idPrefix}g-name`} className={labelCls}>
            Nome da empresa *
          </label>
          <input
            id={`${idPrefix}g-name`}
            className={inputCls}
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Ex.: Loja da Dé, Imports da Maria…"
            autoComplete="off"
          />
        </div>
        <div className="mt-5">
          <span className={labelCls} id={`${idPrefix}g-niche-label`}>
            Qual é o seu nicho? *
          </span>
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            role="group"
            aria-labelledby={`${idPrefix}g-niche-label`}
          >
            {NICHES.map((n) => (
              <button
                key={n.key}
                type="button"
                aria-pressed={niche === n.key}
                onClick={() => setNiche(n.key)}
                className={`rounded-full border px-3 py-2.5 text-sm font-semibold ${
                  niche === n.key
                    ? "btn-glow border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                    : "border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text)]"
                }`}
              >
                {n.label}
              </button>
            ))}
          </div>
          {niche === "outro" && (
            <div className="mt-3">
              <label htmlFor={`${idPrefix}g-niche-custom`} className={labelCls}>
                Escreva o seu nicho *
              </label>
              <input
                id={`${idPrefix}g-niche-custom`}
                className={inputCls}
                value={nicheCustom}
                onChange={(e) => setNicheCustom(e.target.value)}
                placeholder="Ex.: Marcenaria, Fotografia, Aulas…"
                autoComplete="off"
              />
            </div>
          )}
        </div>
        {googleError && (
          <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
            {googleError}
          </p>
        )}
        <button
          type="submit"
          disabled={completeGoogle.isPending}
          className="btn-glow mt-5 w-full rounded-full bg-[var(--accent)] px-4 py-3 text-base font-semibold text-[var(--accent-ink)] disabled:opacity-60"
        >
          {completeGoogle.isPending
            ? "Criando sua conta…"
            : "Concluir cadastro e entrar no painel"}
        </button>
        <button
          type="button"
          onClick={() => {
            setGooglePending(null);
            setGoogleError("");
          }}
          className="mt-3 w-full text-center text-sm text-[var(--dim)] underline"
        >
          Voltar e usar outro jeito de criar a conta
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="card-glow rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-2xl font-extrabold tracking-tight text-[var(--text)]">
          {profile ? "Dados da sua conta" : "Monte sua conta em menos de 1 minuto"}
        </h3>
        {profile && (
          <span className="rounded-full border border-[var(--accent-2)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--accent-2)]">
            Nicho: {nicheLabelOf(profile.niche, profile.nicheCustom)}
          </span>
        )}
        {profile && trialInfo(profile).hasTrial && (
          <span className="rounded-full border border-[var(--accent-2)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--accent-2)]">
            {trialInfo(profile).expired
              ? "Período grátis encerrado"
              : `Grátis até ${formatDateTimeBR(profile.trialEndsAt)} · ${trialInfo(profile).daysLeft} ${trialInfo(profile).daysLeft === 1 ? "dia restante" : "dias restantes"}`}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
        {profile
          ? "É aqui que você troca o nicho ou o nome do negócio. A mudança vale para o painel e para as próximas vendas."
          : "Nome da empresa e nicho escolhidos agora: o painel já abre organizado para o que você vende — Gestão para as vendas locais, Marketplace para o seu nicho."}
      </p>

      {!profile && (
        <div className="mt-5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-alt)] p-4">
          <p className="text-base font-bold text-[var(--text)]">
            Passo 1: criar conta com Google
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
            Primeiro você faz o login com sua conta Google — sem preencher
            nada antes. Só depois do Google confirmado é que o app pede o
            nome da empresa e o nicho.
          </p>
          <div className="mt-3">
            <GoogleSignupStartButton
              onExisting={(googleEmail, token) =>
                onAccountSaved?.(googleEmail, token, true)
              }
              onNeedsProfile={(pending) => {
                setGooglePending(pending);
                setGoogleError("");
                if (!businessName.trim() && pending.name)
                  setBusinessName(pending.name);
              }}
            />
          </div>
          <div
            className="my-4 flex items-center gap-3"
            aria-hidden="true"
          >
            <span className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--dim)]">
              ou crie com e-mail e senha
            </span>
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <p className="text-sm font-semibold text-[var(--text)]">
            Preencha os dados abaixo somente se for criar com e-mail e senha:
          </p>
        </div>
      )}

      <div className="mt-5">
        <label htmlFor={`${idPrefix}acc-name`} className={labelCls}>
          Nome da empresa *
        </label>
        <input
          id={`${idPrefix}acc-name`}
          className={inputCls}
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder="Ex.: Loja da Dé, Imports da Maria…"
          autoComplete="off"
        />
      </div>

      <div className="mt-5">
        <span className={labelCls} id={`${idPrefix}acc-logo-label`}>
          Logo da sua empresa
        </span>
        <div className="flex flex-wrap items-center gap-3">
          {profile?.logoUrl ? (
            <img
              src={profile.logoUrl}
              alt="Logo da sua empresa"
              className="h-16 w-16 rounded-[var(--radius-sm)] border border-[var(--border)] bg-white object-contain p-1"
            />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] text-xs font-semibold text-[var(--dim)]">
              Sem logo
            </span>
          )}
          <div className="flex flex-col gap-2">
            <label
              htmlFor={`${idPrefix}acc-logo`}
              className="btn-glow cursor-pointer rounded-full bg-[var(--accent)] px-4 py-2.5 text-center text-sm font-semibold text-[var(--accent-ink)]"
            >
              {uploadLogo.isPending
                ? "Enviando…"
                : profile?.logoUrl
                  ? "Trocar logo"
                  : "Enviar logo"}
            </label>
            <input
              id={`${idPrefix}acc-logo`}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              aria-labelledby={`${idPrefix}acc-logo-label`}
              onChange={handleLogoFile}
            />
            {profile?.logoUrl && (
              <button
                type="button"
                disabled={removeLogo.isPending}
                onClick={() => removeLogo.mutate({})}
                className="text-sm text-[var(--dim)] underline"
              >
                Remover logo
              </button>
            )}
          </div>
        </div>
        {logoError && (
          <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
            {logoError}
          </p>
        )}
        <p className="mt-1 text-xs text-[var(--dim)]">
          A logo aparece junto do nome da sua empresa no painel.
        </p>
      </div>

      <div className="mt-5">
        <label htmlFor={`${idPrefix}acc-email`} className={labelCls}>
          E-mail da conta {profile ? "" : "*"}
        </label>
        <input
          id={`${idPrefix}acc-email`}
          className={inputCls}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@gmail.com"
          autoComplete="email"
        />
        <p className="mt-1 text-xs text-[var(--dim)]">
          {profile
            ? "É o e-mail oficial da sua conta — pode ser Gmail ou qualquer outro e-mail."
            : "Pode ser seu Gmail ou qualquer outro e-mail. Ao criar a conta, você ganha 7 dias grátis para usar tudo."}
        </p>
      </div>

      <div className="mt-5">
        <label htmlFor={`${idPrefix}acc-password`} className={labelCls}>
          Senha da conta {profile ? "" : "*"}
        </label>
        <input
          id={`${idPrefix}acc-password`}
          className={inputCls}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={profile ? "Nova senha (opcional)" : "Crie uma senha"}
          autoComplete={profile ? "new-password" : "new-password"}
        />
        <p className="mt-1 text-xs text-[var(--dim)]">
          {profile
            ? "Preencha só se quiser trocar a senha. Deixando vazio, a senha atual continua valendo."
            : "Ao criar a conta, você já entra automaticamente — sem precisar fazer login depois — e vai direto para o seu painel."}
        </p>
      </div>

      <div className="mt-5">
        <span className={labelCls} id={`${idPrefix}acc-niche-label`}>
          Qual é o seu nicho? *
        </span>
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          role="group"
          aria-labelledby={`${idPrefix}acc-niche-label`}
        >
          {NICHES.map((n) => (
            <button
              key={n.key}
              type="button"
              aria-pressed={niche === n.key}
              onClick={() => setNiche(n.key)}
              className={`rounded-full border px-3 py-2.5 text-sm font-semibold ${
                niche === n.key
                  ? "btn-glow border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                  : "border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text)]"
              }`}
            >
              {n.label}
            </button>
          ))}
        </div>
        {niche === "outro" && (
          <div className="mt-3">
            <label htmlFor={`${idPrefix}acc-niche-custom`} className={labelCls}>
              Escreva o seu nicho *
            </label>
            <input
              id={`${idPrefix}acc-niche-custom`}
              className={inputCls}
              value={nicheCustom}
              onChange={(e) => setNicheCustom(e.target.value)}
              placeholder="Ex.: Marcenaria, Fotografia, Aulas…"
              autoComplete="off"
            />
          </div>
        )}
        <p className="mt-2 text-xs text-[var(--dim)]">
          O Marketplace é para todos esses nichos — o seu aparece no painel
          assim que a conta é criada.
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {savedMsg && (
        <p role="status" className="mt-3 text-sm font-medium text-[var(--accent-2)]">
          {savedMsg}
        </p>
      )}
      <button
        type="submit"
        disabled={saveProfile.isPending}
        className="btn-glow mt-5 w-full rounded-full bg-[var(--accent)] px-4 py-3 text-base font-semibold text-[var(--accent-ink)] disabled:opacity-60"
      >
        {saveProfile.isPending
          ? "Salvando…"
          : profile
            ? "Salvar alterações da conta"
            : "Criar minha conta"}
      </button>
    </form>
  );
}

// ---------- entrar / criar conta: PÁGINA de acesso (#/auth) ----------
//
// Os botões "Entrar" e "Criar conta" abrem a página de autenticação —
// página dedicada e limpa (AuthPage), separada da página pública e do
// painel. Entrar ou criar a conta leva direto para a página do painel.

type AuthMode = "entrar" | "conta";

// ---------- páginas internas dos nichos: seleção, estoque e venda ----------

const STOCK_INPUT =
  "w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-base text-[var(--text)] outline-none focus:border-[var(--accent)]";
const STOCK_LABEL = "mb-1 block text-sm font-medium text-[var(--text)]";

function chipCls(active: boolean): string {
  return `rounded-full border px-3 py-2 text-sm font-semibold ${
    active
      ? "btn-glow border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
      : "border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text)]"
  }`;
}

/**
 * Hub dos nichos: um cartão por nicho.
 * SEM login, é só demonstração: mostra as categorias e sugestões de cada
 * nicho (dados fixos do catálogo) e o botão leva para entrar/criar conta —
 * nenhum estoque real é lido. COM login, mostra o resumo do estoque de
 * verdade e abre a página funcional do nicho.
 */
function NicheHub({
  onOpen,
  loggedIn,
  onAuth,
}: {
  onOpen: (key: string) => void;
  loggedIn: boolean;
  onAuth: (mode: AuthMode) => void;
}) {
  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: () => api.listProducts({}),
    enabled: loggedIn,
  });
  const products = productsQuery.data?.products ?? [];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {NICHE_PAGES.map((n) => {
        const mine = products.filter((p) => p.niche === n.key);
        const units = mine.reduce((acc, p) => acc + p.stock, 0);
        return (
          <article
            key={n.key}
            className="card-glow flex flex-col rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6"
          >
            <p className="text-sm font-bold uppercase tracking-wide text-[var(--accent-2)]">
              {n.label}
            </p>
            <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-[var(--text)]">
              {n.tagline}
            </h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--dim)]">
              {n.desc}
            </p>
            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-[var(--dim)]">
              {loggedIn
                ? productsQuery.isPending
                  ? "Carregando estoque…"
                  : `${mine.length} ${mine.length === 1 ? "produto" : "produtos"} · ${units} un. em estoque`
                : `${n.categories.length} categorias · ${n.starters.length} sugestões para montar o estoque`}
            </p>
            {loggedIn ? (
              <button
                type="button"
                onClick={() => onOpen(n.key)}
                className="btn-glow mt-4 w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--accent-ink)]"
              >
                Abrir página de {n.label}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onAuth("conta")}
                aria-label={`Entrar para abrir a página de ${n.label}`}
                className="btn-glow mt-4 w-full rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--accent-ink)]"
              >
                Entrar para abrir meu nicho
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}

/** Montar o estoque do nicho: sugestões e seleções, quase sem digitar. */
function StockManager({ niche }: { niche: NichePageData }) {
  const queryClient = useQueryClient();
  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: () => api.listProducts({}),
  });
  const products = (productsQuery.data?.products ?? []).filter(
    (p) => p.niche === niche.key,
  );

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [variant, setVariant] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const [error, setError] = useState("");
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  const addProduct = useMutation({
    mutationFn: api.addProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setName("");
      setPrice("");
      setQty("1");
      setError("");
    },
    onError: () => setError("Não consegui adicionar. Tente de novo."),
  });

  const updateProduct = useMutation({
    mutationFn: api.updateProduct,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });

  const deleteProduct = useMutation({
    mutationFn: api.deleteProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setConfirmingId(null);
    },
  });

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    const cents = parsePriceToCents(price);
    const stockQty = Number(qty);
    if (!name.trim()) {
      setError("Escolha uma sugestão abaixo ou escreva o nome do produto.");
      return;
    }
    if (cents === null || cents <= 0) {
      setError("Preço inválido — use algo como 79,90.");
      return;
    }
    if (!Number.isInteger(stockQty) || stockQty < 0) {
      setError("Quantidade em estoque inválida.");
      return;
    }
    addProduct.mutate({
      niche: niche.key,
      name: name.trim(),
      category,
      variant,
      priceCents: cents,
      stock: stockQty,
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form
        onSubmit={handleAdd}
        className="card-glow rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <h3 className="text-xl font-extrabold tracking-tight text-[var(--text)]">
          Montar meu estoque
        </h3>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Toque numa sugestão para preencher — você só ajusta preço e
          quantidade.
        </p>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Sugestões de produtos">
          {niche.starters.map((s) => (
            <button
              key={s.name}
              type="button"
              aria-pressed={name === s.name}
              onClick={() => {
                setName(s.name);
                setCategory(s.category);
              }}
              className={chipCls(name === s.name)}
            >
              {s.name}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <label htmlFor={`stk-name-${niche.key}`} className={STOCK_LABEL}>
            Produto
          </label>
          <input
            id={`stk-name-${niche.key}`}
            className={STOCK_INPUT}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Toque numa sugestão ou escreva aqui"
            autoComplete="off"
          />
        </div>

        <div className="mt-4">
          <span className={STOCK_LABEL} id={`stk-cat-${niche.key}`}>
            Categoria
          </span>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`stk-cat-${niche.key}`}>
            {niche.categories.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                onClick={() => setCategory(category === c ? "" : c)}
                className={chipCls(category === c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <span className={STOCK_LABEL} id={`stk-var-${niche.key}`}>
            {niche.variationLabel}
          </span>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`stk-var-${niche.key}`}>
            {niche.variations.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={variant === v}
                onClick={() => setVariant(variant === v ? "" : v)}
                className={chipCls(variant === v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`stk-price-${niche.key}`} className={STOCK_LABEL}>
              Preço (R$) *
            </label>
            <input
              id={`stk-price-${niche.key}`}
              className={STOCK_INPUT}
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="79,90"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor={`stk-qty-${niche.key}`} className={STOCK_LABEL}>
              Qtd. em estoque
            </label>
            <input
              id={`stk-qty-${niche.key}`}
              className={STOCK_INPUT}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={addProduct.isPending}
          className="btn-glow mt-4 w-full rounded-full bg-[var(--accent)] px-4 py-3 text-base font-semibold text-[var(--accent-ink)] disabled:opacity-60"
        >
          {addProduct.isPending ? "Adicionando…" : "Adicionar ao estoque"}
        </button>
      </form>

      <section className="card-glow rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="text-xl font-extrabold tracking-tight text-[var(--text)]">
          Estoque de {niche.label}
        </h3>
        {productsQuery.isPending ? (
          <p className="mt-3 text-sm text-[var(--dim)]">Carregando…</p>
        ) : products.length === 0 ? (
          <p className="mt-3 text-sm leading-relaxed text-[var(--dim)]">
            Nenhum produto ainda. Monte seu estoque ao lado com as sugestões —
            depois é só vender pela seleção, sem digitar.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {products.map((p) => (
              <li key={p.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-medium text-[var(--text)]">
                      {p.name}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--dim)]">
                      {[p.category, p.variant].filter(Boolean).join(" · ") ||
                        "Sem categoria"}
                      {" · "}
                      {formatBRL(p.priceCents)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={`Tirar 1 de ${p.name} do estoque`}
                        disabled={updateProduct.isPending || p.stock <= 0}
                        onClick={() =>
                          updateProduct.mutate({ id: p.id, stock: p.stock - 1 })
                        }
                        className="h-8 w-8 rounded-full border border-[var(--border)] bg-[var(--surface-alt)] text-base font-bold text-[var(--text)] disabled:opacity-40"
                      >
                        −
                      </button>
                      <span
                        className={`min-w-14 text-center text-sm font-bold ${
                          p.stock <= 0
                            ? "text-[var(--danger)]"
                            : "text-[var(--text)]"
                        }`}
                      >
                        {p.stock <= 0 ? "Esgotado" : `${p.stock} un.`}
                      </span>
                      <button
                        type="button"
                        aria-label={`Adicionar 1 de ${p.name} ao estoque`}
                        disabled={updateProduct.isPending}
                        onClick={() =>
                          updateProduct.mutate({ id: p.id, stock: p.stock + 1 })
                        }
                        className="h-8 w-8 rounded-full border border-[var(--border)] bg-[var(--surface-alt)] text-base font-bold text-[var(--text)] disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                    {confirmingId === p.id ? (
                      <div className="mt-1.5 flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={deleteProduct.isPending}
                          onClick={() => deleteProduct.mutate({ id: p.id })}
                          className="text-sm font-semibold text-[var(--danger)]"
                        >
                          Confirmar remoção
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          className="text-sm text-[var(--dim)]"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Remover ${p.name} do estoque`}
                        onClick={() => setConfirmingId(p.id)}
                        className="mt-1.5 text-sm text-[var(--dim)] underline"
                      >
                        Remover
                      </button>
                    )}
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        aria-pressed={p.resale}
                        aria-label={`${p.resale ? "Liberado" : "Liberar"} ${p.name} para revenda`}
                        disabled={updateProduct.isPending}
                        onClick={() =>
                          updateProduct.mutate({ id: p.id, resale: !p.resale })
                        }
                        className={chipCls(p.resale)}
                      >
                        {p.resale ? "✓ Na revenda" : "Liberar p/ revenda"}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Vender pela seleção: toca no produto, confirma, o estoque baixa sozinho. */
function QuickSale({ niche }: { niche: NichePageData }) {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.getProfile({}),
  });
  const trialExpired = trialInfo(profileQuery.data?.profile ?? null).expired;
  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: () => api.listProducts({}),
  });
  const products = (productsQuery.data?.products ?? []).filter(
    (p) => p.niche === niche.key,
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [segment, setSegment] = useState<Segment>("marketplace");
  const [channel, setChannel] = useState(CHANNELS_MARKETPLACE[0] ?? "Marketplace");
  const [date, setDate] = useState(todayISO());
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const selected = products.find((p) => p.id === selectedId) ?? null;

  const sell = useMutation({
    mutationFn: api.sellProduct,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      setError("");
      setQty(1);
      setMsg(
        `Venda registrada! Estoque atualizado: restam ${res.remainingStock} un.`,
      );
      playSaleSound();
    },
    onError: (e) =>
      setError(
        e instanceof Error ? e.message : "Não consegui salvar. Tente de novo.",
      ),
  });

  function changeSegment(next: Segment) {
    setSegment(next);
    setChannel(channelsFor(next)[0] ?? "Outro");
  }

  function handleSell() {
    if (trialExpired) {
      setError(
        "Seu período grátis de 7 dias acabou. Fale com a Pingou Venda para reativar e voltar a vender.",
      );
      return;
    }
    if (!selected) {
      setError("Toque num produto do estoque para vender.");
      return;
    }
    if (qty < 1 || qty > selected.stock) {
      setError(`Quantidade inválida: há ${selected.stock} un. em estoque.`);
      return;
    }
    if (!date) {
      setError("Escolha a data da venda.");
      return;
    }
    setMsg("");
    sell.mutate({
      productId: selected.id,
      quantity: qty,
      date,
      channel,
      segment,
    });
  }

  return (
    <section className="card-glow rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-xl font-extrabold tracking-tight text-[var(--text)]">
        Vender por seleção — sem digitar
      </h3>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Toque no produto, ajuste a quantidade e confirme: a venda entra no
        painel e o estoque baixa sozinho.
      </p>

      {productsQuery.isPending ? (
        <p className="mt-4 text-sm text-[var(--dim)]">Carregando estoque…</p>
      ) : products.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-[var(--dim)]">
          Seu estoque deste nicho está vazio. Monte o estoque abaixo e os
          produtos aparecem aqui para vender por toque.
        </p>
      ) : (
        <>
          <div
            className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3"
            role="group"
            aria-label="Produtos em estoque"
          >
            {products.map((p) => {
              const out = p.stock <= 0;
              const active = selectedId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={out}
                  aria-pressed={active}
                  onClick={() => {
                    setSelectedId(p.id);
                    setQty(1);
                    setMsg("");
                    setError("");
                  }}
                  className={`rounded-[var(--radius-sm)] border p-3 text-left ${
                    active
                      ? "btn-glow border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                      : "border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text)]"
                  } ${out ? "opacity-45" : ""}`}
                >
                  <span className="block truncate text-sm font-bold">{p.name}</span>
                  <span className={`mt-0.5 block text-xs ${active ? "" : "text-[var(--dim)]"}`}>
                    {[p.category, p.variant].filter(Boolean).join(" · ")}
                  </span>
                  <span className="mt-1.5 block text-sm font-extrabold">
                    {formatBRL(p.priceCents)}
                  </span>
                  <span className={`mt-0.5 block text-xs font-semibold ${active ? "" : out ? "text-[var(--danger)]" : "text-[var(--dim)]"}`}>
                    {out ? "Esgotado" : `${p.stock} em estoque`}
                  </span>
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="mt-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-alt)] p-3">
              <p className="text-sm font-bold text-[var(--text)]">
                {selected.name}
                {selected.variant ? ` · ${selected.variant}` : ""} —{" "}
                {formatBRL(selected.priceCents)} cada
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <span className={STOCK_LABEL} id={`qs-qty-${niche.key}`}>
                    Quantidade
                  </span>
                  <div className="flex items-center gap-2" role="group" aria-labelledby={`qs-qty-${niche.key}`}>
                    <button
                      type="button"
                      aria-label="Diminuir quantidade"
                      onClick={() => setQty((q) => Math.max(1, q - 1))}
                      className="h-10 w-10 rounded-full border border-[var(--border)] bg-[var(--surface)] text-lg font-bold text-[var(--text)]"
                    >
                      −
                    </button>
                    <span className="min-w-8 text-center text-lg font-extrabold text-[var(--text)]">
                      {qty}
                    </span>
                    <button
                      type="button"
                      aria-label="Aumentar quantidade"
                      onClick={() =>
                        setQty((q) => Math.min(selected.stock, q + 1))
                      }
                      className="h-10 w-10 rounded-full border border-[var(--border)] bg-[var(--surface)] text-lg font-bold text-[var(--text)]"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor={`qs-total-${niche.key}`} className={STOCK_LABEL}>
                    Total da venda
                  </label>
                  <p id={`qs-total-${niche.key}`} className="py-1.5 text-2xl font-extrabold tracking-tight text-[var(--text)]">
                    {formatBRL(selected.priceCents * qty)}
                  </p>
                </div>
                <div>
                  <span className={STOCK_LABEL} id={`qs-seg-${niche.key}`}>
                    Frente
                  </span>
                  <div className="flex gap-2" role="group" aria-labelledby={`qs-seg-${niche.key}`}>
                    {SEGMENTS.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        aria-pressed={segment === s.key}
                        onClick={() => changeSegment(s.key)}
                        className={chipCls(segment === s.key)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label htmlFor={`qs-channel-${niche.key}`} className={STOCK_LABEL}>
                    Canal
                  </label>
                  <select
                    id={`qs-channel-${niche.key}`}
                    className={STOCK_INPUT}
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                  >
                    {channelsFor(segment).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`qs-date-${niche.key}`} className={STOCK_LABEL}>
                    Data
                  </label>
                  <input
                    id={`qs-date-${niche.key}`}
                    className={STOCK_INPUT}
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
              </div>
              {error && (
                <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
                  {error}
                </p>
              )}
              {msg && (
                <p role="status" className="mt-3 text-sm font-medium text-[var(--accent-2)]">
                  {msg}
                </p>
              )}
              {trialExpired && (
                <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
                  Seu período grátis de 7 dias acabou. Fale com a Pingou
                  Venda para reativar sua conta.
                </p>
              )}
              <button
                type="button"
                disabled={sell.isPending || trialExpired}
                onClick={handleSell}
                className="btn-glow mt-4 w-full rounded-full bg-[var(--accent)] px-4 py-3 text-base font-semibold text-[var(--accent-ink)] disabled:opacity-60"
              >
                {sell.isPending ? "Registrando…" : "Confirmar venda"}
              </button>
            </div>
          )}
          {!selected && error && (
            <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
              {error}
            </p>
          )}
          {!selected && msg && (
            <p role="status" className="mt-3 text-sm font-medium text-[var(--accent-2)]">
              {msg}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Página interna de um nicho: números, venda por seleção e estoque. */
function NichePage({
  niche,
  onBack,
}: {
  niche: NichePageData;
  onBack: () => void;
}) {
  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: () => api.listProducts({}),
  });
  const salesQuery = useQuery({
    queryKey: ["sales", "niche-page"],
    queryFn: () => api.listSales({}),
  });
  const products = (productsQuery.data?.products ?? []).filter(
    (p) => p.niche === niche.key,
  );
  const units = products.reduce((acc, p) => acc + p.stock, 0);
  const stockValue = products.reduce(
    (acc, p) => acc + p.stock * p.priceCents,
    0,
  );
  const nicheSales = (salesQuery.data?.sales ?? []).filter(
    (s) => s.segment === "marketplace" && s.niche === niche.label,
  );
  const nicheRevenue = nicheSales.reduce((acc, s) => acc + saleTotal(s), 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-28 sm:pt-32">
      <button
        type="button"
        onClick={onBack}
        className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--text)]"
      >
        ← Voltar ao painel
      </button>
      <div className="mt-6">
        <PillBadge>Página do nicho</PillBadge>
        <h1 className="t-display mt-4 text-[var(--text)]">
          {niche.label}{" "}
          <span className="font-accent-word">{niche.tagline}.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-[var(--dim)] sm:text-lg">
          {niche.desc}
        </p>
      </div>

      <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Números do nicho">
        {[
          { label: "Produtos no estoque", value: String(products.length) },
          { label: "Unidades em estoque", value: String(units) },
          { label: "Valor em estoque", value: formatBRL(stockValue) },
          { label: "Faturamento do nicho", value: formatBRL(nicheRevenue) },
        ].map((m) => (
          <div
            key={m.label}
            className="card-glow rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-3"
          >
            <p className="text-2xl font-extrabold tracking-tight text-[var(--text)] sm:text-3xl">
              {productsQuery.isPending || salesQuery.isPending ? "…" : m.value}
            </p>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-[var(--dim)]">
              {m.label}
            </p>
          </div>
        ))}
      </section>

      <div className="mt-6">
        <QuickSale niche={niche} />
      </div>
      <div className="mt-4">
        <StockManager niche={niche} />
      </div>
    </div>
  );
}

// ---------- barras por grupo (categoria / nicho / canal) ----------

function GroupBars({ title, groups }: { title: string; groups: GroupTotal[] }) {
  const max = groups[0]?.total ?? 0;
  if (groups.length === 0) return null;
  return (
    <section className="card-glow rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-xl font-extrabold tracking-tight text-[var(--text)]">{title}</h3>
      <div className="mt-3 space-y-3">
        {groups.map((g, i) => (
          <div key={g.name}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium text-[var(--text)]">{g.name}</span>
              <span className="text-lg font-extrabold tracking-tight text-[var(--text)]">
                {formatBRL(g.total)}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--surface-alt)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${max > 0 ? Math.max(4, (g.total / max) * 100) : 0}%`,
                  background: CHART_COLORS[i % CHART_COLORS.length],
                }}
              />
            </div>
            <p className="mt-0.5 text-xs text-[var(--dim)]">
              {g.pieces} {g.pieces === 1 ? "item" : "itens"}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- página de vendas: SÓ a lista de vendas ----------
//
// Tela própria, totalmente separada do painel: aqui NÃO entra nenhuma
// métrica do dashboard (sem faturamento, sem cartões de resumo, sem
// gráfico, sem rankings, sem seletor de período do painel). É só a lista
// de vendas reais — busca por produto, filtro por canal, ordenação,
// tabela completa (no celular vira cartões), paginação e exportação em
// CSV — sobre TODAS as vendas, sem recorte do painel.

type SaleSortKey = "recente" | "antiga" | "maior" | "menor";

const SALE_SORTS: { key: SaleSortKey; label: string }[] = [
  { key: "recente", label: "Mais recentes" },
  { key: "antiga", label: "Mais antigas" },
  { key: "maior", label: "Maior valor" },
  { key: "menor", label: "Menor valor" },
];

const SALES_PAGE_SIZE = 10;

function SaleActions({
  sale,
  confirmingId,
  onAsk,
  onCancel,
  onConfirm,
  deleting,
}: {
  sale: Sale;
  confirmingId: number | null;
  onAsk: (id: number) => void;
  onCancel: () => void;
  onConfirm: (id: number) => void;
  deleting: boolean;
}) {
  if (confirmingId === sale.id) {
    return (
      <span className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={deleting}
          onClick={() => onConfirm(sale.id)}
          className="text-sm font-semibold text-[var(--danger)]"
        >
          Confirmar exclusão
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-[var(--dim)]"
        >
          Cancelar
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={`Excluir venda de ${sale.item}`}
      onClick={() => onAsk(sale.id)}
      className="text-sm text-[var(--dim)] underline"
    >
      Excluir
    </button>
  );
}

function SalesPage({
  sales,
  confirmingId,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  deleting,
}: {
  sales: Sale[];
  confirmingId: number | null;
  onAskDelete: (id: number) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (id: number) => void;
  deleting: boolean;
}) {
  const [query, setQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState("todos");
  const [sortKey, setSortKey] = useState<SaleSortKey>("recente");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [query, channelFilter, sortKey, sales]);

  const channels = useMemo(() => {
    const set = new Set<string>();
    for (const s of sales) if (s.channel) set.add(s.channel);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [sales]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = sales.filter((s) => {
      if (channelFilter !== "todos" && s.channel !== channelFilter)
        return false;
      if (!q) return true;
      const hay = [
        s.item,
        s.category,
        s.channel,
        s.niche,
        segmentLabel(s.segment),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    const sorted = [...rows];
    switch (sortKey) {
      case "recente":
        sorted.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
        break;
      case "antiga":
        sorted.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
        break;
      case "maior":
        sorted.sort((a, b) => saleTotal(b) - saleTotal(a));
        break;
      case "menor":
        sorted.sort((a, b) => saleTotal(a) - saleTotal(b));
        break;
    }
    return sorted;
  }, [sales, query, channelFilter, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / SALES_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (safePage - 1) * SALES_PAGE_SIZE,
    safePage * SALES_PAGE_SIZE,
  );
  const filtersActive =
    query.trim() !== "" || channelFilter !== "todos" || sortKey !== "recente";

  function clearFilters() {
    setQuery("");
    setChannelFilter("todos");
    setSortKey("recente");
  }

  function exportCsv() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
    const header = [
      "Data",
      "Produto",
      "Frente",
      "Nicho",
      "Categoria",
      "Tamanho",
      "Canal",
      "Qtd",
      "Preço unitário (R$)",
      "Total (R$)",
      "Status",
    ];
    const lines = filtered.map((s) =>
      [
        formatDateBR(s.date),
        s.item,
        segmentLabel(s.segment),
        s.niche,
        s.category,
        s.size,
        s.channel,
        String(s.quantity),
        money(s.unitPriceCents),
        money(saleTotal(s)),
        "Concluída",
      ]
        .map(esc)
        .join(";"),
    );
    const csv = "﻿" + [header.map(esc).join(";"), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vendas-pingou-venda.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectCls =
    "w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-base text-[var(--text)] outline-none focus:border-[var(--accent)]";
  const labelCls = "mb-1 block text-sm font-medium text-[var(--text)]";

  const statusPill = (
    <span className="rounded-full border border-[var(--accent-2)] px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-[var(--accent-2)]">
      Concluída
    </span>
  );

  // Sem nenhuma venda: nada de tabela ou exemplos — só a mensagem
  // honesta. Esta página mostra TODAS as vendas (sem recorte do painel),
  // então lista vazia significa que ainda não há venda nenhuma.
  if (sales.length === 0) {
    return (
      <section className="mt-8" aria-label="Página de vendas">
        <h3 className="text-xl font-extrabold tracking-tight text-[var(--text)]">
          Página de vendas
        </h3>
        <div className="card-glow mt-4 rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center">
          <p className="text-lg font-extrabold tracking-tight text-[var(--text)]">
            Ainda não há vendas registradas
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--dim)]">
            Registre a venda no formulário acima, nesta mesma página, e ela
            aparece aqui — com busca, filtros, ordenação e exportação.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-8" aria-label="Página de vendas">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-extrabold tracking-tight text-[var(--text)]">
            Página de vendas
          </h3>
          <p className="mt-0.5 text-sm text-[var(--dim)]">
            Só a lista: busque, filtre, ordene e exporte — {sales.length}{" "}
            {sales.length === 1 ? "venda registrada" : "vendas registradas"}.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
        >
          Exportar CSV
        </button>
      </div>

      {/* Busca, canal e ordenação — controles DESTA página (nada do painel) */}
      <div className="card-glow mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
        <div>
          <label htmlFor="sales-search" className={labelCls}>
            Buscar venda
          </label>
          <input
            id="sales-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Produto, categoria, nicho ou canal…"
            className={selectCls}
            autoComplete="off"
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="sales-channel" className={labelCls}>
              Canal
            </label>
            <select
              id="sales-channel"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className={selectCls}
            >
              <option value="todos">Todos os canais</option>
              {channels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sales-sort" className={labelCls}>
              Ordenar por
            </label>
            <select
              id="sales-sort"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SaleSortKey)}
              className={selectCls}
            >
              {SALE_SORTS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-[var(--dim)]" role="status">
            {filtered.length}{" "}
            {filtered.length === 1 ? "venda encontrada" : "vendas encontradas"}
          </p>
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm font-semibold text-[var(--accent-2)] underline"
            >
              Limpar busca e filtros
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card-glow mt-4 rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center">
          <p className="text-lg font-extrabold tracking-tight text-[var(--text)]">
            Nenhuma venda bate com essa busca
          </p>
          <p className="mt-1 text-sm text-[var(--dim)]">
            Tente outro produto ou limpe a busca e os filtros para ver todas
            as vendas.
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="btn-glow mt-3 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--accent-ink)]"
          >
            Limpar busca e filtros
          </button>
        </div>
      ) : (
        <>
          {/* Tabela completa (telas maiores) */}
          <div className="card-glow mt-4 hidden overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-alt)] text-xs uppercase tracking-wide text-[var(--dim)]">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Data
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Produto
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Detalhes
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Canal
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right font-semibold"
                  >
                    Qtd × Unit.
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right font-semibold"
                  >
                    Total
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {pageRows.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 whitespace-nowrap text-[var(--dim)]">
                      {formatDateBR(s.date)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-[var(--text)]">
                        {s.item}
                      </p>
                      <p className="text-xs text-[var(--dim)]">
                        {segmentLabel(s.segment)}
                        {s.segment === "marketplace" && s.niche
                          ? ` · ${s.niche}`
                          : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-[var(--dim)]">
                      {[s.category, s.size ? `Tam. ${s.size}` : ""]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-[var(--dim)]">
                      {s.channel}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-[var(--dim)]">
                      {s.quantity} × {formatBRL(s.unitPriceCents)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold whitespace-nowrap text-[var(--text)]">
                      {formatBRL(saleTotal(s))}
                    </td>
                    <td className="px-4 py-3">{statusPill}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <SaleActions
                        sale={s}
                        confirmingId={confirmingId}
                        onAsk={onAskDelete}
                        onCancel={onCancelDelete}
                        onConfirm={onConfirmDelete}
                        deleting={deleting}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cartões (celular) */}
          <ul className="card-glow mt-4 divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] md:hidden">
            {pageRows.map((s) => (
              <li key={s.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-medium text-[var(--text)]">
                      {s.item}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--dim)]">
                      {[
                        segmentLabel(s.segment),
                        s.segment === "marketplace" ? s.niche : "",
                        s.category,
                        s.size ? `Tam. ${s.size}` : "",
                        s.channel,
                        formatDateBR(s.date),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--dim)]">
                      {s.quantity} × {formatBRL(s.unitPriceCents)}
                    </p>
                    <p className="mt-1.5">{statusPill}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-extrabold tracking-tight text-[var(--text)]">
                      {formatBRL(saleTotal(s))}
                    </p>
                    <div className="mt-1">
                      <SaleActions
                        sale={s}
                        confirmingId={confirmingId}
                        onAsk={onAskDelete}
                        onCancel={onCancelDelete}
                        onConfirm={onConfirmDelete}
                        deleting={deleting}
                      />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Paginação da lista (sem subtotal: total é métrica do painel) */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--dim)]">
              Mostrando {pageRows.length} de {filtered.length}{" "}
              {filtered.length === 1 ? "venda" : "vendas"}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-1.5 text-sm font-medium text-[var(--text)] disabled:opacity-40"
                >
                  Anterior
                </button>
                <span className="text-sm text-[var(--dim)]">
                  Página {safePage} de {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(safePage + 1)}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-1.5 text-sm font-medium text-[var(--text)] disabled:opacity-40"
                >
                  Próxima
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ---------- painel (dashboard) e página de vendas: PÁGINAS separadas ----------
//
// O sistema tem PÁGINAS próprias, nunca misturadas na mesma tela:
// a página "painel" é SÓ o dashboard (faturamento, gráfico, rankings,
// dados do cliente logado) — ele mostra, nunca vende. A página "vendas"
// é a página de vendas: é lá que mora o REGISTRAR VENDA (vender por
// seleção, com baixa automática no estoque), junto da lista de vendas
// (busca, tabela, CSV). A página inicial é outra página: apresentação e
// demonstração, sem painel e sem vender. Criar a conta / entrar leva
// para a PÁGINA DO PAINEL — a página de vendas só abre quando a pessoa
// navega até ela. Cada página tem endereço próprio (#/painel e
// #/vendas), então dá para abrir, voltar e compartilhar a página certa.

type SistemaView = "painel" | "vendas";
type AppPage = "inicio" | "painel" | "vendas" | "auth";

function pageFromHash(): AppPage {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h.startsWith("painel")) return "painel";
  if (h.startsWith("vendas")) return "vendas";
  if (h.startsWith("auth") || h.startsWith("entrar")) return "auth";
  return "inicio";
}

function hashForPage(page: AppPage): string {
  return page === "inicio" ? "#/" : `#/${page}`;
}

function Tracker({ view }: { view: SistemaView }) {
  const queryClient = useQueryClient();
  const [periodKey, setPeriodKey] = useState<PeriodKey>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>("todos");
  const [nicheFilter, setNicheFilter] = useState<string>("todos");
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  // Nicho do REGISTRAR VENDA da página de vendas: começa no nicho da
  // conta e a pessoa pode trocar ali mesmo, sem sair da página.
  const [sellNicheKey, setSellNicheKey] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.getProfile({}),
  });
  const profile: Profile = profileQuery.data?.profile ?? null;
  const accountNicheLabel = profile
    ? nicheLabelOf(profile.niche, profile.nicheCustom)
    : "";
  const trial = trialInfo(profile);

  // Nicho efetivo do registrar venda (página de vendas): o escolhido ali,
  // ou o nicho da conta quando ele tem página própria, ou o primeiro.
  const sellNiche: NichePageData =
    (sellNicheKey ? nichePageOf(sellNicheKey) : undefined) ??
    (profile ? nichePageOf(profile.niche) : undefined) ??
    (NICHE_PAGES[0] as NichePageData);

  const range = useMemo(
    () => periodRange(periodKey, customFrom, customTo),
    [periodKey, customFrom, customTo],
  );

  const salesQuery = useQuery({
    queryKey: ["sales", range.from ?? "", range.to ?? ""],
    queryFn: () => api.listSales(range),
  });

  // Lista COMPLETA de vendas, sem nenhum recorte: é a fonte da página de
  // vendas (aba própria). O painel usa a consulta com período/filtros
  // acima; a página de vendas NUNCA usa o recorte do painel.
  const totalSalesQuery = useQuery({
    queryKey: ["sales", "total"],
    queryFn: () => api.listSales({}),
  });
  const vendasSales = totalSalesQuery.data?.sales ?? [];
  const hasAnySale = vendasSales.length > 0;

  const deleteSale = useMutation({
    mutationFn: (id: number) => api.deleteSale({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      setConfirmingId(null);
    },
  });

  const allSales = salesQuery.data?.sales ?? [];

  const nicheOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of allSales) {
      if (s.segment === "marketplace" && s.niche) set.add(s.niche);
    }
    if (accountNicheLabel) set.add(accountNicheLabel);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allSales, accountNicheLabel]);

  const sales = useMemo(
    () =>
      allSales.filter((s) => {
        if (segmentFilter !== "todos" && s.segment !== segmentFilter)
          return false;
        if (nicheFilter !== "todos") {
          if (s.segment !== "marketplace") return false;
          if ((s.niche || "Sem nicho") !== nicheFilter) return false;
        }
        return true;
      }),
    [allSales, segmentFilter, nicheFilter],
  );

  const segmentTotals = useMemo(
    () =>
      SEGMENTS.map((seg) => {
        const rows = allSales.filter((s) => s.segment === seg.key);
        return {
          ...seg,
          revenue: rows.reduce((acc, s) => acc + saleTotal(s), 0),
          pieces: rows.reduce((acc, s) => acc + s.quantity, 0),
          count: rows.length,
        };
      }),
    [allSales],
  );

  const metrics = useMemo(() => {
    const revenue = sales.reduce((acc, s) => acc + saleTotal(s), 0);
    const pieces = sales.reduce((acc, s) => acc + s.quantity, 0);
    const count = sales.length;
    return {
      revenue,
      pieces,
      count,
      ticket: count > 0 ? Math.round(revenue / count) : 0,
    };
  }, [sales]);

  const series = useMemo(() => buildSeries(sales, range), [sales, range]);
  const byCategoryGestao = useMemo(
    () =>
      groupTotals(
        allSales.filter((s) => s.segment === "gestao"),
        (s) => s.category || "Sem categoria",
      ),
    [allSales],
  );
  const byNicheMarketplace = useMemo(
    () =>
      groupTotals(
        allSales.filter((s) => s.segment === "marketplace"),
        (s) => s.niche || "Sem nicho",
      ),
    [allSales],
  );
  const byChannel = useMemo(
    () => groupTotals(sales, (s) => s.channel),
    [sales],
  );
  const ranking = useMemo(() => {
    const map = new Map<string, { name: string; pieces: number; total: number }>();
    for (const s of sales) {
      const cur = map.get(s.item) ?? { name: s.item, pieces: 0, total: 0 };
      cur.pieces += s.quantity;
      cur.total += saleTotal(s);
      map.set(s.item, cur);
    }
    return [...map.values()]
      .sort((a, b) => b.pieces - a.pieces || b.total - a.total)
      .slice(0, 5);
  }, [sales]);

  const hasSales = sales.length > 0;

  return (
    <div>
      {/* Faixa da conta: SÓ no painel — nunca na página de vendas */}
      {view === "painel" && profile ? (
        <div className="card-glow mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <p className="flex items-center gap-3 text-sm text-[var(--text)]">
            {profile.logoUrl && (
              <img
                src={profile.logoUrl}
                alt={`Logo de ${profile.businessName || "sua empresa"}`}
                className="h-10 w-10 rounded-[var(--radius-sm)] border border-[var(--border)] bg-white object-contain p-0.5"
              />
            )}
            <span>
            <span className="font-bold">
              {profile.businessName || "Seu negócio"}
            </span>{" "}
            · Nicho:{" "}
            <span className="font-bold text-[var(--accent-2)]">
              {accountNicheLabel}
            </span>
            </span>
          </p>
          <button
            type="button"
            onClick={goConta}
            className="rounded-full border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1.5 text-sm font-semibold text-[var(--text)]"
          >
            Editar conta
          </button>
        </div>
      ) : (
        view === "painel" &&
        !profileQuery.isPending && (
          <div className="card-glow mb-6 rounded-[var(--radius)] border border-dashed border-[var(--accent-2)] bg-[var(--surface)] px-4 py-4 text-center">
            <p className="text-base font-bold text-[var(--text)]">
              Você ainda não criou sua conta
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-[var(--dim)]">
              Crie agora e escolha seu nicho: o painel fica organizado do seu
              jeito desde a primeira venda.
            </p>
            <button
              type="button"
              onClick={goConta}
              className="btn-glow mt-3 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--accent-ink)]"
            >
              Criar conta e escolher meu nicho
            </button>
          </div>
        )
      )}

      {/* Período grátis da conta — SÓ no painel */}
      {view === "painel" && profile && trial.hasTrial && (
        <div
          className={`card-glow mb-6 rounded-[var(--radius)] border px-4 py-3 ${
            trial.expired
              ? "border-[var(--danger)] bg-[var(--surface)]"
              : "border-[var(--border)] bg-[var(--surface)]"
          }`}
          role={trial.expired ? "alert" : undefined}
        >
          <p className="text-sm text-[var(--text)]">
            {trial.expired ? (
              <>
                <span className="font-bold text-[var(--danger)]">
                  Seu período grátis de 7 dias acabou.
                </span>{" "}
                Fale com a Pingou Venda para reativar sua conta e voltar a
                registrar vendas — seu histórico continua salvo aqui.
              </>
            ) : (
              <>
                <span className="font-bold">Período grátis ativo:</span>{" "}
                restam {trial.daysLeft}{" "}
                {trial.daysLeft === 1 ? "dia" : "dias"} (até{" "}
                {formatDateTimeBR(profile.trialEndsAt)}). Aproveite para
                montar seu estoque e vender por seleção.
              </>
            )}
          </p>
        </div>
      )}

      {/* Sem abas aqui dentro: Painel e Página de vendas são PÁGINAS
          separadas do app (endereços #/painel e #/vendas). A navegação
          entre elas fica na barra de páginas de cada página (PageNav),
          nunca um painel embutido dentro da página de vendas. */}

      {/* Período — SÓ do painel: define o recorte das métricas do
          dashboard. A página de vendas não tem período: ela lista tudo. */}
      {view === "painel" && (
        <>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Período das métricas"
      >
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={periodKey === p.key}
            onClick={() => setPeriodKey(p.key)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${
              periodKey === p.key
                ? "btn-glow border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {periodKey === "custom" && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="range-from"
              className="mb-1 block text-sm font-medium text-[var(--text)]"
            >
              De
            </label>
            <input
              id="range-from"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text)]"
            />
          </div>
          <div>
            <label
              htmlFor="range-to"
              className="mb-1 block text-sm font-medium text-[var(--text)]"
            >
              Até
            </label>
            <input
              id="range-to"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base text-[var(--text)]"
            />
          </div>
        </div>
      )}
        </>
      )}

      {/* Dashboard (aba Painel): frentes, faturamento e métricas — só aqui,
          nunca junto da página de vendas */}
      {view === "painel" && (
        <>
      {/* Frentes separadas: Gestão (vendas locais) x Marketplace (nichos) */}
      <section className="pt-8" aria-label="Frentes separadas">
        <h3 className="text-xl font-extrabold tracking-tight text-[var(--text)]">
          Gestão e Marketplace, separados
        </h3>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Toque numa frente para ver só ela no painel — toque de novo para
          voltar a ver tudo junto. Os valores são do período escolhido acima.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {segmentTotals.map((seg) => (
            <button
              key={seg.key}
              type="button"
              aria-pressed={segmentFilter === seg.key}
              aria-label={`Ver só ${seg.label}`}
              onClick={() =>
                setSegmentFilter((cur) => (cur === seg.key ? "todos" : seg.key))
              }
              className={`card-glow rounded-[var(--radius)] border p-4 text-left ${
                segmentFilter === seg.key
                  ? "border-[var(--accent-2)] bg-[var(--surface-alt)]"
                  : "border-[var(--border)] bg-[var(--surface)]"
              }`}
            >
              <p className="text-sm font-bold uppercase tracking-wide text-[var(--accent-2)]">
                {seg.label}
                <span className="ml-2 font-semibold normal-case tracking-normal text-[var(--dim)]">
                  {seg.tagline}
                </span>
              </p>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-[var(--text)]">
                {salesQuery.isPending ? "…" : formatBRL(seg.revenue)}
              </p>
              <p className="mt-1 text-xs text-[var(--dim)]">
                {seg.pieces} {seg.pieces === 1 ? "item vendido" : "itens vendidos"} ·{" "}
                {seg.count} {seg.count === 1 ? "venda" : "vendas"}
                {segmentFilter === seg.key ? " · mostrando só esta frente" : ""}
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* Filtro por nicho (Marketplace) */}
      {nicheOptions.length > 0 && (
        <section className="pt-6" aria-label="Filtro por nicho">
          <p className="text-sm font-semibold uppercase tracking-wide text-[var(--dim)]">
            Filtrar o Marketplace por nicho
          </p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Nichos do Marketplace">
            <button
              type="button"
              aria-pressed={nicheFilter === "todos"}
              onClick={() => setNicheFilter("todos")}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${
                nicheFilter === "todos"
                  ? "btn-glow border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
              }`}
            >
              Todos os nichos
            </button>
            {nicheOptions.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={nicheFilter === n}
                onClick={() =>
                  setNicheFilter((cur) => (cur === n ? "todos" : n))
                }
                className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${
                  nicheFilter === n
                    ? "btn-glow border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
                }`}
              >
                {n}
                {n === accountNicheLabel ? " · seu nicho" : ""}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Faturamento */}
      <section className="pt-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--dim)]">
          Faturamento no período
        </p>
        <p className="mt-2 text-6xl font-extrabold leading-none tracking-[-0.03em] text-[var(--text)] sm:text-7xl">
          {salesQuery.isPending ? "…" : formatBRL(metrics.revenue)}
        </p>
        <p className="mt-3 text-sm font-medium text-[var(--dim)]">
          {periodCaption(periodKey, range)}
          {segmentFilter !== "todos"
            ? ` · ${segmentLabel(segmentFilter)}`
            : " · Gestão + Marketplace"}
          {nicheFilter !== "todos" ? ` · nicho ${nicheFilter}` : ""}
        </p>
      </section>

      {/* Métricas secundárias */}
      <section className="mt-6 grid grid-cols-3 gap-3">
        {[
          { label: "Itens vendidos", value: String(metrics.pieces) },
          { label: "Nº de vendas", value: String(metrics.count) },
          { label: "Ticket médio", value: formatBRL(metrics.ticket) },
        ].map((m) => (
          <div
            key={m.label}
            className="card-glow rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-3"
          >
            <p className="text-2xl font-extrabold tracking-tight text-[var(--text)] sm:text-3xl">
              {salesQuery.isPending ? "…" : m.value}
            </p>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-[var(--dim)]">
              {m.label}
            </p>
          </div>
        ))}
      </section>

        </>
      )}

      {view === "painel" && salesQuery.isError && (
        <p role="alert" className="mt-6 text-sm text-[var(--danger)]">
          Não consegui carregar os números do painel.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => salesQuery.refetch()}
          >
            Tentar de novo
          </button>
        </p>
      )}

      {/* REGISTRAR VENDA — mora SÓ na página de vendas: é aqui que se
          vende (seleção de produto + baixa automática no estoque). O
          painel NÃO vende: ele só mostra as métricas. */}
      {view === "vendas" && (
        <section className="mt-2" aria-label="Registrar venda">
          <h3 className="text-xl font-extrabold tracking-tight text-[var(--text)]">
            Registrar venda
          </h3>
          <p className="mt-1 text-sm text-[var(--dim)]">
            Página de vendas é para vender: escolha o nicho, toque no
            produto, ajuste a quantidade e confirme — a venda entra na lista
            abaixo e o estoque baixa sozinho.
          </p>
          <div
            className="mt-3 flex flex-wrap gap-2"
            role="group"
            aria-label="Nicho da venda"
          >
            {NICHE_PAGES.map((n) => (
              <button
                key={n.key}
                type="button"
                aria-pressed={sellNiche.key === n.key}
                onClick={() => setSellNicheKey(n.key)}
                className={chipCls(sellNiche.key === n.key)}
              >
                {n.label}
                {profile && profile.niche === n.key ? " · seu nicho" : ""}
              </button>
            ))}
          </div>
          <div className="mt-4">
            <QuickSale niche={sellNiche} />
          </div>
          <div className="mt-4">
            <StockManager niche={sellNiche} />
          </div>
        </section>
      )}

      {/* Aba Página de vendas: a lista de vendas — sem faixa da conta,
          sem período, sem métrica nenhuma do painel. A fonte é a lista
          completa (vendasSales), nunca o recorte do painel. */}
      {view === "vendas" && totalSalesQuery.isPending && (
        <p className="mt-6 text-sm text-[var(--dim)]">
          Carregando suas vendas…
        </p>
      )}
      {view === "vendas" && totalSalesQuery.isError && (
        <p role="alert" className="mt-6 text-sm text-[var(--danger)]">
          Não consegui carregar suas vendas.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => totalSalesQuery.refetch()}
          >
            Tentar de novo
          </button>
        </p>
      )}
      {view === "vendas" &&
        !totalSalesQuery.isPending &&
        !totalSalesQuery.isError &&
        totalSalesQuery.data && (
          <SalesPage
            sales={vendasSales}
            confirmingId={confirmingId}
            onAskDelete={(id) => setConfirmingId(id)}
            onCancelDelete={() => setConfirmingId(null)}
            onConfirmDelete={(id) => deleteSale.mutate(id)}
            deleting={deleteSale.isPending}
          />
        )}

      {/* Aba Painel sem vendas no recorte: aviso SÓ do dashboard — sem
          lista, sem prévia e sem cartão da página de vendas aqui dentro */}
      {view === "painel" &&
        !salesQuery.isPending &&
        !hasSales &&
        !salesQuery.isError &&
        totalSalesQuery.data && (
          <div className="card-glow mt-6 rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center">
            <p className="text-lg font-extrabold tracking-tight text-[var(--text)]">
              {hasAnySale
                ? "Nenhuma venda neste recorte"
                : "Seu painel está pronto"}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-[var(--dim)]">
              {hasAnySale
                ? "Ajuste o período ou os filtros acima para ver os números do painel neste recorte."
                : "Você já está na página do seu painel — ela só mostra os números. Para vender, abra a página de vendas e registre a venda lá: o faturamento, o gráfico e os rankings aparecem aqui."}
            </p>
          </div>
        )}

      {view === "painel" && hasSales && (
        <>
          {/* Gráfico por dia / mês */}
          <section className="card-glow mt-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="text-xl font-extrabold tracking-tight text-[var(--text)]">
              Faturamento por dia
            </h3>
            <div className="mt-3 h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={series}
                  margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--border)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "var(--dim)" }}
                    tickLine={false}
                    axisLine={{ stroke: "var(--border)" }}
                    interval="preserveStartEnd"
                    minTickGap={24}
                  />
                  <YAxis
                    width={52}
                    tick={{ fontSize: 11, fill: "var(--dim)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => brlCompact.format(v / 100)}
                  />
                  <Tooltip
                    formatter={(value) => [
                      formatBRL(Number(value ?? 0)),
                      "Faturamento",
                    ]}
                    labelStyle={{ color: "var(--text)" }}
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      color: "var(--text)",
                    }}
                    cursor={{ fill: "var(--surface-alt)" }}
                  />
                  <Bar dataKey="total" radius={[3, 3, 0, 0]}>
                    {series.map((point, i) => (
                      <Cell
                        key={`${point.label}-${i}`}
                        fill={
                          point.total ===
                            Math.max(...series.map((p) => p.total)) &&
                          point.total > 0
                            ? "var(--accent-2)"
                            : "var(--chart-bar)"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {segmentFilter !== "marketplace" && (
              <GroupBars
                title="Categorias — Gestão (vendas locais)"
                groups={byCategoryGestao}
              />
            )}
            {segmentFilter !== "gestao" && (
              <GroupBars
                title="Marketplace por nicho"
                groups={byNicheMarketplace}
              />
            )}
            <GroupBars title="Por canal" groups={byChannel} />
          </div>

          {/* Ranking */}
          {ranking.length > 0 && (
            <section className="card-glow mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="text-xl font-extrabold tracking-tight text-[var(--text)]">
                {segmentFilter === "gestao"
                  ? "Mais vendidos — Gestão (vendas locais)"
                  : segmentFilter === "marketplace"
                    ? "Mais vendidos — Marketplace"
                    : "Mais vendidos"}
              </h3>
              <ol className="mt-3 space-y-2.5">
                {ranking.map((r, i) => (
                  <li key={r.name} className="flex items-baseline gap-3">
                    <span className="font-step-num text-2xl leading-none">
                      {i + 1}.
                    </span>
                    <span className="flex-1 text-sm text-[var(--text)]">
                      {r.name}
                    </span>
                    <span className="text-sm text-[var(--dim)]">
                      {r.pieces} {r.pieces === 1 ? "item" : "itens"} ·{" "}
                      {formatBRL(r.total)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

        </>
      )}
    </div>
  );
}

// ---------- demonstração pública: a página de vendas SÓ demonstra ----------
//
// Quem NÃO entrou vê apenas isto no lugar do sistema: um exemplo visual
// do painel e da venda por seleção, com valores ilustrativos. A interação
// é local (selecionar produto, ajustar quantidade, ver o total) e NÃO
// chama o servidor, NÃO lê vendas nem estoque reais e NÃO registra nada.
// O painel de verdade — com os dados reais da conta — só é montado
// depois do login (ver o App: <Tracker> só renderiza com sessão válida).

const DEMO_PRODUCTS: {
  name: string;
  detail: string;
  priceCents: number;
  stock: number;
}[] = [
  { name: "Vestido midi floral", detail: "Vestuário · M", priceCents: 12990, stock: 8 },
  { name: "Camiseta básica", detail: "Vestuário · G", priceCents: 5990, stock: 15 },
  { name: "Calça jeans wide leg", detail: "Vestuário · 40", priceCents: 14990, stock: 6 },
  { name: "Jaqueta jeans", detail: "Vestuário · P", priceCents: 18990, stock: 4 },
];

const DEMO_SALES: { item: string; meta: string; totalCents: number }[] = [
  { item: "Vestido midi floral", meta: "Gestão · WhatsApp", totalCents: 12990 },
  { item: "Fone de ouvido bluetooth", meta: "Marketplace · Eletrônicos", totalCents: 8990 },
  { item: "Perfume importado 100 ml", meta: "Marketplace · Imports", totalCents: 24990 },
];

const DEMO_BARS: { label: string; pct: number }[] = [
  { label: "seg", pct: 35 },
  { label: "ter", pct: 55 },
  { label: "qua", pct: 42 },
  { label: "qui", pct: 70 },
  { label: "sex", pct: 58 },
  { label: "sáb", pct: 88 },
  { label: "dom", pct: 76 },
];

function DemoPanel({ onAuth }: { onAuth: (mode: AuthMode) => void }) {
  const [selected, setSelected] = useState(0);
  const [qty, setQty] = useState(1);
  const [triedSell, setTriedSell] = useState(false);
  const product = DEMO_PRODUCTS[selected] ?? DEMO_PRODUCTS[0];

  return (
    <div aria-label="Demonstração do painel">
      <div className="flex flex-wrap items-center justify-center gap-2 text-center">
        <span className="rounded-full border border-[var(--accent-2)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--accent-2)]">
          Demonstração
        </span>
        <p className="text-sm text-[var(--dim)]">
          Valores de exemplo — o painel de verdade, com suas vendas e seu
          estoque, só aparece depois do login.
        </p>
      </div>

      {/* Métricas de exemplo */}
      <section className="mt-6" aria-label="Exemplo de métricas do painel">
        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--dim)]">
          Faturamento no período · exemplo
        </p>
        <p className="mt-2 text-6xl font-extrabold leading-none tracking-[-0.03em] text-[var(--text)] sm:text-7xl">
          {formatBRL(428000)}
        </p>
        <div className="mt-6 grid grid-cols-3 gap-3">
          {[
            { label: "Itens vendidos", value: "86" },
            { label: "Nº de vendas", value: "34" },
            { label: "Ticket médio", value: formatBRL(12588) },
          ].map((m) => (
            <div
              key={m.label}
              className="card-glow rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-3"
            >
              <p className="text-2xl font-extrabold tracking-tight text-[var(--text)] sm:text-3xl">
                {m.value}
              </p>
              <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-[var(--dim)]">
                {m.label}
              </p>
            </div>
          ))}
        </div>
        <div
          aria-hidden="true"
          className="card-glow mt-4 flex h-36 items-end gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
        >
          {DEMO_BARS.map((b) => (
            <div key={b.label} className="flex flex-1 flex-col items-center gap-2">
              <div
                className="w-full rounded-t-[3px] bg-[var(--chart-bar)]"
                style={{ height: `${b.pct}%` }}
              />
              <span className="text-[11px] font-medium text-[var(--dim)]">
                {b.label}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Venda por seleção de exemplo: interação local, nada é salvo */}
      <section
        className="card-glow mt-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
        aria-label="Exemplo de registrar venda"
      >
        <h3 className="text-xl font-extrabold tracking-tight text-[var(--text)]">
          Registrar venda — exemplo
        </h3>
        <p className="mt-1 text-sm text-[var(--dim)]">
          No painel de verdade é assim: toque no produto, ajuste a
          quantidade e confirme — a venda entra e o estoque baixa sozinho.
          Experimente aqui: é só demonstração, nada fica salvo.
        </p>
        <div
          className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"
          role="group"
          aria-label="Produtos de exemplo"
        >
          {DEMO_PRODUCTS.map((p, i) => (
            <button
              key={p.name}
              type="button"
              aria-pressed={selected === i}
              onClick={() => {
                setSelected(i);
                setQty(1);
                setTriedSell(false);
              }}
              className={`rounded-[var(--radius-sm)] border p-3 text-left ${
                selected === i
                  ? "btn-glow border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                  : "border-[var(--border)] bg-[var(--surface-alt)] text-[var(--text)]"
              }`}
            >
              <span className="block truncate text-sm font-bold">{p.name}</span>
              <span
                className={`mt-0.5 block text-xs ${selected === i ? "" : "text-[var(--dim)]"}`}
              >
                {p.detail}
              </span>
              <span className="mt-1.5 block text-sm font-extrabold">
                {formatBRL(p.priceCents)}
              </span>
              <span
                className={`mt-0.5 block text-xs font-semibold ${selected === i ? "" : "text-[var(--dim)]"}`}
              >
                {p.stock} em estoque
              </span>
            </button>
          ))}
        </div>
        {product && (
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <div
              className="flex items-center gap-2"
              role="group"
              aria-label="Quantidade do exemplo"
            >
              <button
                type="button"
                aria-label="Diminuir quantidade do exemplo"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="h-10 w-10 rounded-full border border-[var(--border)] bg-[var(--surface)] text-lg font-bold text-[var(--text)]"
              >
                −
              </button>
              <span className="min-w-8 text-center text-lg font-extrabold text-[var(--text)]">
                {qty}
              </span>
              <button
                type="button"
                aria-label="Aumentar quantidade do exemplo"
                onClick={() => setQty((q) => Math.min(product.stock, q + 1))}
                className="h-10 w-10 rounded-full border border-[var(--border)] bg-[var(--surface)] text-lg font-bold text-[var(--text)]"
              >
                +
              </button>
            </div>
            <p className="text-2xl font-extrabold tracking-tight text-[var(--text)]">
              {formatBRL(product.priceCents * qty)}
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={() => setTriedSell(true)}
          className="btn-glow mt-4 w-full rounded-full bg-[var(--accent)] px-4 py-3 text-base font-semibold text-[var(--accent-ink)]"
        >
          Confirmar venda
        </button>
        {triedSell && (
          <p role="status" className="mt-3 text-sm font-medium text-[var(--accent-2)]">
            Viu como é rápido? Isso foi só a demonstração — para registrar
            vendas de verdade, entre na sua conta ou crie uma agora.
          </p>
        )}
      </section>

      {/* Lista de vendas de exemplo */}
      <section className="mt-6" aria-label="Exemplo de lista de vendas">
        <h3 className="text-xl font-extrabold tracking-tight text-[var(--text)]">
          Suas vendas, uma por uma — exemplo
        </h3>
        <ul className="card-glow mt-3 divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
          {DEMO_SALES.map((s) => (
            <li
              key={s.item}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-base font-medium text-[var(--text)]">
                  {s.item}
                </p>
                <p className="mt-0.5 text-xs text-[var(--dim)]">{s.meta}</p>
              </div>
              <p className="shrink-0 text-lg font-extrabold tracking-tight text-[var(--text)]">
                {formatBRL(s.totalCents)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => onAuth("conta")}
          className="btn-glow w-full rounded-full bg-[var(--accent)] px-8 py-4 text-base font-semibold text-[var(--accent-ink)] sm:w-auto"
        >
          Criar conta e abrir meu painel
        </button>
        <button
          type="button"
          onClick={() => onAuth("entrar")}
          className="w-full rounded-full border border-[var(--border)] bg-transparent px-8 py-4 text-base font-semibold text-[var(--text)] sm:w-auto"
        >
          Entrar no meu painel
        </button>
      </div>
    </div>
  );
}

// ---------- seções da página (estrutura editorial) ----------

function SectionHeading({
  kicker,
  title,
  sub,
}: {
  kicker: string;
  title: ReactNode;
  sub?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <PillBadge>{kicker}</PillBadge>
      <h2 className="t-display mt-4 text-[var(--text)]">{title}</h2>
      {sub && (
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-[var(--dim)] sm:text-lg">
          {sub}
        </p>
      )}
    </div>
  );
}

function MarqueeRow({
  items,
  reverse = false,
  dark = false,
}: {
  items: string[];
  reverse?: boolean;
  dark?: boolean;
}) {
  const row = (ariaHidden: boolean) => (
    <div aria-hidden={ariaHidden || undefined} className="flex shrink-0 items-center">
      {items.map((item) => (
        <span key={item} className="flex items-center">
          <span className="px-5 text-[15px] font-semibold tracking-[0.04em] sm:text-base">
            {item}
          </span>
          <span className={dark ? "text-white/85" : "text-[var(--accent-2)]"}>✦</span>
        </span>
      ))}
    </div>
  );
  return (
    <div
      className={`marquee border-y py-3 ${
        dark
          ? "gradient-purple-bg border-[var(--accent)] text-[var(--accent-ink)]"
          : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
      }`}
    >
      <div className={`marquee-track ${reverse ? "reverse" : ""}`}>
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}

function HeroShowcase() {
  const highlightColors = [
    "#9d4edd",
    "#c77dff",
    "#e0aaff",
    "#7b2ff7",
    "#a855f7",
    "#5a189a",
  ];
  const cards = [
    { name: "Vestuário", note: "nicho", bars: [40, 65, 52, 85, 70] },
    { name: "Eletrônicos", note: "nicho", bars: [55, 45, 75, 60, 95] },
    { name: "Imports", note: "nicho", bars: [35, 60, 80, 55, 90] },
    { name: "Estoque", note: "por nicho", bars: [70, 50, 62, 88, 66] },
    { name: "Gestão local", note: "frente", bars: [48, 72, 58, 92, 78] },
    { name: "Marketplace", note: "frente", bars: [62, 44, 84, 69, 100] },
  ];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none mx-auto mt-12 grid max-w-4xl select-none grid-cols-3 gap-2.5 sm:gap-3 lg:grid-cols-6"
    >
      {cards.map((c, ci) => (
        <div
          key={c.name}
          className="card-glow rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 text-left"
        >
          <div className="flex h-16 items-end gap-1 sm:h-20">
            {c.bars.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-[2px]"
                style={{
                  height: `${h}%`,
                  background:
                    i === c.bars.length - 1
                      ? highlightColors[ci % highlightColors.length]
                      : "var(--chart-bar)",
                }}
              />
            ))}
          </div>
          <p className="mt-3 truncate text-sm font-bold tracking-tight text-[var(--text)]">
            {c.name}
          </p>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--dim)]">
            {c.note}
          </p>
        </div>
      ))}
    </div>
  );
}

const STATS: { value: string; label: string }[] = [
  { value: "2", label: "frentes: Gestão de vendas locais e Marketplace" },
  { value: String(NICHES.length), label: "nichos para escolher na criação da conta" },
  { value: "6", label: "períodos de análise, de hoje ao histórico completo" },
  { value: "100%", label: "das vendas salvas, separadas por frente e por nicho" },
];

const STEPS: { n: string; title: string; text: string }[] = [
  {
    n: "1",
    title: "Crie a conta no seu nicho",
    text: "Nome do negócio e nicho escolhidos na hora: o painel já abre falando a língua do que você vende.",
  },
  {
    n: "2",
    title: "Monte o estoque e venda por toque",
    text: "Na página do seu nicho, monte o estoque com as sugestões em toques. Para vender, escolha o produto na seleção — sem digitar — e o estoque baixa sozinho.",
  },
  {
    n: "3",
    title: "Decida com os números",
    text: "Faturamento, ticket médio, rankings e o filtro por nicho mostram onde apostar e o que divulgar.",
  },
];

const METHOD: { title: string; text: string }[] = [
  {
    title: "Frentes separadas, sempre",
    text: "A Gestão cuida das vendas locais; o Marketplace, das vendas da vitrine. Totais, categorias e rankings de uma frente nunca se misturam com a outra.",
  },
  {
    title: "Nicho desde o cadastro",
    text: "O nicho escolhido ao criar a conta aparece no painel, entra em cada venda do Marketplace e vira filtro: você compara nicho com nicho, sem chute.",
  },
  {
    title: "Categorias de cada nicho",
    text: "Vestuário tem as peças e os tamanhos dele; eletrônicos, os modelos; imports, as variações dele. Marketplace organizado, nicho por nicho.",
  },
  {
    title: "Canais com total próprio",
    text: "Loja, WhatsApp, Instagram, feira, loja online e entrega local separados: você descobre de onde o dinheiro realmente vem.",
  },
  {
    title: "Estoque sempre certo",
    text: "O estoque é montado uma vez, por seleção, e baixa sozinho a cada venda: você sempre sabe o que ainda tem, sem contar de cabeça.",
  },
];

const TIMELINE: { label: string; title: string; text: string }[] = [
  {
    label: "Antes",
    title: "A conta criada",
    text: "Negócio cadastrado e nicho escolhido: o painel já abre organizado para o que você vende.",
  },
  {
    label: "Dia 1",
    title: "A primeira venda local",
    text: "Venda da Gestão lançada em segundos, direto do celular.",
  },
  {
    label: "Semana 1",
    title: "O Marketplace girando",
    text: "Produtos do seu nicho vendidos na vitrine, com total separado da Gestão.",
  },
  {
    label: "Mês 1",
    title: "O mês fechado",
    text: "Faturamento por frente e por nicho, ticket médio e o estoque conferido, sem contar nada de cabeça.",
  },
  {
    label: "Todo mês",
    title: "A decisão certa",
    text: "Com o histórico na mão, você sabe qual nicho e qual produto merecem o próximo investimento.",
  },
];

const BENEFITS: { title: string; text: string }[] = [
  {
    title: "Gestão feita para o local",
    text: "A frente de Gestão foi pensada para quem vende na cidade: loja, feira, WhatsApp e entrega local, com o fechamento do dia em um número só.",
  },
  {
    title: "Marketplace para todos os nichos",
    text: "Imports, vestuário e eletrônicos: cada nicho com página própria, categorias, estoque e totais dele, dentro da mesma conta.",
  },
  {
    title: "Organização desde o primeiro clique",
    text: "A conta já nasce com o seu nicho. Nada de painel genérico: categorias, textos e filtros acompanham o que você vende.",
  },
  {
    title: "Histórico que fica",
    text: "Suas vendas ficam salvas no app, separadas por frente e por nicho — e o estoque acompanha cada venda, sempre atualizado.",
  },
];

const COMPARE_OLD: string[] = [
  "Venda local guardada de cabeça e esquecida no fim do dia",
  "Um negócio só, sem vitrine para outros nichos",
  "Ninguém sabe qual produto — ou qual nicho — vende mais",
  "WhatsApp, feira e loja misturados, sem total por canal",
  "Estoque contado no olho, sem saber o que ainda tem",
];

const COMPARE_NEW: string[] = [
  "Gestão das vendas locais registrada na hora, pelo celular",
  "Marketplace aberto para todos os nichos, numa conta só",
  "Ranking de produtos e filtro por nicho sempre à vista",
  "Totais separados por frente, canal e categoria",
  "Estoque montado por seleção, que baixa sozinho a cada venda",
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "Qual é a diferença entre Gestão e Marketplace?",
    a: "A Gestão é a frente das suas vendas locais — loja, feira, WhatsApp e entrega na sua cidade — acompanhada neste painel. O Marketplace é a vitrine da Pingou Venda para todos os nichos. As duas frentes ficam separadas no painel, cada uma com seus totais, categorias e rankings.",
  },
  {
    q: "Preciso escolher um nicho para criar a conta?",
    a: "Sim — e é de propósito. Ao criar a conta, você informa o nome do negócio e escolhe o nicho: o painel já abre organizado para o que você vende, com as categorias do seu nicho. Se precisar, dá para trocar o nicho depois, nos dados da conta.",
  },
  {
    q: "Quais nichos o Marketplace aceita?",
    a: "Imports, vestuário e eletrônicos — cada um com página própria, seleção de categorias e estoque dele. Se o seu não estiver na lista, escolha “Outro” ao criar a conta e escreva o nicho: ele passa a aparecer no painel e nas vendas.",
  },
  {
    q: "Como registro uma venda?",
    a: "Abra a página do nicho, monte o estoque uma vez e depois venda por seleção — toque no produto, ajuste a quantidade e confirme. A venda entra no painel e o estoque baixa sozinho.",
  },
  {
    q: "Gestão e Marketplace se misturam?",
    a: "Não. Cada venda entra numa frente — e, no Marketplace, num nicho — com total, categorias e ranking separados. No painel, você vê tudo junto, só uma frente ou só um nicho.",
  },
  {
    q: "Posso corrigir uma venda lançada errada?",
    a: "Sim. Na lista de vendas do período, toque em “Excluir” na venda errada, confirme e lance de novo com os dados certos.",
  },
  {
    q: "Como funciona o estoque?",
    a: "Na página de cada nicho você monta o estoque em toques: sugestões de produtos, categorias e variações (tamanho, modelo, cor) já vêm na seleção — você só ajusta preço e quantidade. Cada venda por seleção baixa o estoque na hora, e os botões + e − corrigem a contagem quando entra mercadoria nova.",
  },
  {
    q: "Funciona no celular?",
    a: "Sim. Conta, painel e registro de venda foram pensados primeiro para o celular: tudo leva segundos, direto da tela inicial.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[var(--border)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 py-5 text-left"
      >
        <span className="text-xl font-bold tracking-tight text-[var(--text)]">{q}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-5 w-5 shrink-0 text-[var(--accent-2)] transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <p className="pb-5 text-base leading-relaxed text-[var(--dim)]">{a}</p>
      )}
    </div>
  );
}

// ---------- navegação flutuante em pílula ----------

/**
 * Barra de PÁGINAS do app: Página inicial × Painel × Página de vendas.
 * Cada uma é uma página separada, com endereço próprio (#/, #/painel,
 * #/vendas) — não é aba nem seção da mesma página.
 */
function PageNav({
  current,
  onNavigate,
}: {
  current: AppPage;
  onNavigate: (page: AppPage) => void;
}) {
  const items: { key: AppPage; label: string }[] = [
    { key: "inicio", label: "Página inicial" },
    { key: "painel", label: "Painel" },
    { key: "vendas", label: "Página de vendas" },
  ];
  return (
    <nav
      aria-label="Páginas do app"
      className="mb-6 flex gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1.5"
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-current={current === item.key ? "page" : undefined}
          aria-label={
            item.key === "painel"
              ? "Ir para a página do painel"
              : item.key === "vendas"
                ? "Ir para a página de vendas"
                : "Ir para a página inicial"
          }
          onClick={() => onNavigate(item.key)}
          className={`flex-1 rounded-full px-3 py-2.5 text-sm font-bold ${
            current === item.key
              ? "btn-glow bg-[var(--accent)] text-[var(--accent-ink)]"
              : "text-[var(--text)]"
          }`}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

/** Porta de entrada do painel/vendas para quem ainda não entrou. */
function PageLoginGate({
  title,
  text,
  onAuth,
  onGoHome,
}: {
  title: string;
  text: string;
  onAuth: (mode: AuthMode) => void;
  onGoHome: () => void;
}) {
  return (
    <div className="card-glow rounded-[var(--radius)] border border-dashed border-[var(--accent-2)] bg-[var(--surface)] p-6 text-center">
      <h2 className="text-2xl font-extrabold tracking-tight text-[var(--text)]">
        {title}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--dim)]">
        {text}
      </p>
      <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => onAuth("entrar")}
          className="btn-glow rounded-full bg-[var(--accent)] px-6 py-3 text-base font-semibold text-[var(--accent-ink)]"
        >
          Entrar na minha conta
        </button>
        <button
          type="button"
          onClick={() => onAuth("conta")}
          className="rounded-full border border-[var(--border)] px-6 py-3 text-base font-semibold text-[var(--text)]"
        >
          Criar conta
        </button>
        <button
          type="button"
          onClick={onGoHome}
          className="rounded-full px-6 py-3 text-base font-semibold text-[var(--dim)] underline"
        >
          Voltar à página inicial
        </button>
      </div>
    </div>
  );
}

function TopNav({
  onNavigate,
  onAuth,
  currentPage,
}: {
  onNavigate?: (id: string) => void;
  onAuth?: (mode: AuthMode) => void;
  currentPage?: AppPage;
}) {
  // Painel e Vendas são PÁGINAS separadas: Painel abre a página do
  // dashboard (#/painel); Vendas abre a página de vendas (#/vendas).
  // Nichos e FAQ são seções da página inicial; Entrar/Criar conta abrem
  // a página de acesso (#/auth).
  const links: { id: string; label: string; hideOnMobile?: boolean }[] = [
    { id: "inicio", label: "Início", hideOnMobile: true },
    { id: "painel", label: "Painel" },
    { id: "vendas", label: "Vendas", hideOnMobile: true },
    { id: "nichos", label: "Nichos", hideOnMobile: true },
    { id: "faq", label: "FAQ", hideOnMobile: true },
  ];
  const go = (id: string) => {
    if (onNavigate) onNavigate(id);
    else scrollToId(id);
  };
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 top-3 z-50 flex justify-center px-3 pt-[env(safe-area-inset-top)] sm:top-4"
    >
      <div className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)]/95 p-1.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)]">
        <button
          type="button"
          onClick={() =>
            onNavigate
              ? onNavigate("topo")
              : window.scrollTo({ top: 0, behavior: "smooth" })
          }
          aria-label="Pingcou Venda — voltar ao topo"
          className="flex shrink-0 items-center rounded-full px-2 py-1"
        >
          <img
            src={logoPingcou}
            alt="Pingcou Venda"
            className="h-6 w-auto sm:h-7"
          />
        </button>
        {links.map((l) => {
          const isCurrentPage =
            (l.id === "painel" && currentPage === "painel") ||
            (l.id === "vendas" && currentPage === "vendas") ||
            (l.id === "inicio" && currentPage === "inicio");
          return (
            <button
              key={l.id}
              type="button"
              aria-current={isCurrentPage ? "page" : undefined}
              onClick={() => go(l.id)}
              className={`rounded-full px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-[var(--surface-alt)] ${
                isCurrentPage
                  ? "bg-[var(--surface-alt)] text-[var(--accent-2)]"
                  : "text-[var(--text)]"
              } ${l.hideOnMobile ? "hidden sm:block" : ""}`}
            >
              {l.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            if (onAuth) onAuth("entrar");
            else go("acesso");
          }}
          className="whitespace-nowrap rounded-full border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--text)]"
        >
          Entrar
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            if (onAuth) onAuth("conta");
            else go("acesso");
          }}
          className="btn-glow whitespace-nowrap rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-[var(--accent-ink)]"
        >
          Criar conta
        </button>
      </div>
    </nav>
  );
}

// ---------- rodapé com Instagram ----------

function IconInstagram() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.4" cy="6.6" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-6xl px-4 pb-14">
      <img
        src={logoPingcou}
        alt="Pingcou Venda"
        className="mx-auto w-[180px] max-w-[60vw] opacity-90"
      />
      <p className="mt-4 text-center text-sm text-[var(--dim)]">
        Pingcou Venda — Gestão de vendas locais e Marketplace para todos os
        nichos.
      </p>
      <div className="mt-5 flex justify-center">
        <a
          href="https://www.instagram.com/pingoouvenda/"
          target="_blank"
          rel="noreferrer"
          aria-label="Instagram da Pingou Venda — @pingoouvenda"
          className="btn-glow inline-flex items-center gap-2.5 rounded-full bg-[var(--accent)] px-5 py-3 text-base font-semibold text-[var(--accent-ink)]"
        >
          <IconInstagram />
          @pingoouvenda
        </a>
      </div>
      <p className="mt-3 text-center text-xs text-[var(--dim)]">
        Siga a Pingou Venda no Instagram.
      </p>
    </footer>
  );
}

// ---------- app ----------

export function App() {
  const [nicheView, setNicheView] = useState<string | null>(null);
  const activeNiche = nicheView ? nichePageOf(nicheView) : undefined;

  // PÁGINAS do app — cada uma separada, com endereço próprio:
  // "inicio" (#/) é a página inicial (apresentação + demonstração);
  // "painel" (#/painel) é a página SÓ do dashboard funcional (métricas,
  // gráficos e dados do cliente logado); "vendas" (#/vendas) é a página
  // de vendas. Criar conta / entrar cai SEMPRE na página do painel.
  const [appPage, setAppPage] = useState<AppPage>(() => pageFromHash());

  // O endereço (#/painel, #/vendas) e a página aberta andam juntos:
  // voltar/avançar do navegador troca de página de verdade.
  useEffect(() => {
    function onHash() {
      setAppPage(pageFromHash());
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const goPage = useCallback((page: AppPage) => {
    setNicheView(null);
    setAppPage(page);
    const target = hashForPage(page);
    if (window.location.hash !== target) {
      window.location.hash = target;
    }
    window.scrollTo({ top: 0 });
  }, []);

  // Entrar / Criar conta abrem a PÁGINA DE ACESSO (#/auth) — página
  // dedicada e limpa, no mesmo app (nada de nova aba do navegador).
  // authMode diz se ela abre em "entrar" ou em "conta" (cadastro).
  const [authMode, setAuthMode] = useState<AuthMode>("entrar");
  const openAuth = useCallback(
    (mode: AuthMode) => {
      setAuthMode(mode);
      goPage("auth");
    },
    [goPage],
  );

  // Pedidos de "abrir a conta" vindos de dentro das páginas (goConta, no
  // painel) chegam por evento: a conta abre sempre na página de acesso.
  useEffect(() => {
    function onOpenAuth(e: Event) {
      const mode = (e as CustomEvent<string>).detail;
      openAuth(mode === "entrar" ? "entrar" : "conta");
    }
    window.addEventListener("pingcou:open-auth", onOpenAuth);
    return () => window.removeEventListener("pingcou:open-auth", onOpenAuth);
  }, [openAuth]);

  // Sessão de login (e-mail + token), lembrada neste aparelho.
  const [session, setSession] = useState<LoginSession | null>(() => {
    try {
      const raw = window.localStorage.getItem(LOGIN_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<LoginSession>;
      return parsed.email && parsed.token
        ? { email: parsed.email, token: parsed.token }
        : null;
    } catch {
      return null;
    }
  });
  // "Lembrar acesso" marcado: a sessão fica salva neste aparelho e a
  // pessoa entra direto nas próximas visitas. Desmarcado: a sessão vale
  // só nesta visita e nada fica salvo.
  const handleLogin = useCallback(
    (email: string, token: string | null, remember = true) => {
      if (!token) return;
      const next = { email, token };
      setSession(next);
      try {
        if (remember) {
          window.localStorage.setItem(LOGIN_SESSION_KEY, JSON.stringify(next));
        } else {
          window.localStorage.removeItem(LOGIN_SESSION_KEY);
        }
      } catch {
        // Sem armazenamento disponível: a sessão vale só nesta visita.
      }
    },
    [],
  );
  const handleLogout = useCallback(() => {
    setSession(null);
    try {
      window.localStorage.removeItem(LOGIN_SESSION_KEY);
    } catch {
      // Nada para limpar.
    }
  }, []);

  // Ir para a PÁGINA DO PAINEL (dashboard) — página própria, separada da
  // página inicial e da página de vendas. É o destino de quem acabou de
  // criar a conta ou de entrar.
  const goPainel = useCallback(() => {
    goPage("painel");
  }, [goPage]);

  // Ir para a PÁGINA DE VENDAS — página própria, separada do painel.
  const goVendas = useCallback(() => {
    goPage("vendas");
  }, [goPage]);

  // Ir para a PÁGINA INICIAL — apresentação e demonstração, sem painel.
  const goInicio = useCallback(() => {
    goPage("inicio");
  }, [goPage]);

  // Login feito: abre a sessão, BUSCA os dados do cliente (perfil com o
  // nicho da conta) e vai direto para o painel — que abre configurado
  // para esse nicho (nome, nicho, categorias e filtros dele).
  const queryClient = useQueryClient();

  // Login de verdade = sessão salva NESTE aparelho E token ainda válido
  // no servidor. Só com login o painel funcional (dados reais) é montado;
  // sem login, a página mostra apenas a demonstração (DemoPanel).
  const sessionCheck = useQuery({
    queryKey: ["session", session?.email, session?.token],
    queryFn: () =>
      api.checkSession({
        email: session?.email ?? "",
        sessionToken: session?.token ?? "",
      }),
    enabled: Boolean(session),
  });
  const loggedIn = Boolean(session && sessionCheck.data?.profile);
  const sessionChecking = Boolean(session) && sessionCheck.isPending;

  const handleLoggedIn = useCallback(
    (email: string, token: string | null, remember = true) => {
      if (!token) return;
      handleLogin(email, token, remember);
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["session"] });
      goPainel();
    },
    [handleLogin, goPainel, queryClient],
  );

  // Conta salva: na CRIAÇÃO, entra automaticamente (sessão aberta com o
  // token que voltou do salvamento, sem pedir login) e vai direto para o
  // painel — nunca para a página de vendas. Ao só editar a conta, fica
  // onde está.
  const handleAccountSaved = useCallback(
    (email: string, token: string | null, wasCreation: boolean) => {
      if (!token) return;
      handleLogin(email, token);
      // Dados frescos do cliente para o painel abrir já no nicho da conta.
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["session"] });
      if (wasCreation) goPainel();
    },
    [handleLogin, goPainel, queryClient],
  );

  function openNiche(key: string) {
    // A página do nicho é funcional (estoque e venda reais): só abre
    // depois do login. Sem login, pede para entrar/criar a conta.
    if (!loggedIn) {
      openAuth("conta");
      return;
    }
    setNicheView(key);
    window.scrollTo({ top: 0 });
  }

  function navigateFromNiche(id: string) {
    if (id === "painel" || id === "sistema") {
      goPainel();
      return;
    }
    if (id === "vendas") {
      goVendas();
      return;
    }
    setNicheView(null);
    if (id === "topo" || id === "inicio") {
      goInicio();
      return;
    }
    // Seções (Nichos, FAQ) moram na página inicial.
    goInicio();
    window.setTimeout(() => scrollToId(id), 80);
  }

  // Navegação principal: Painel e Vendas abrem as PÁGINAS deles; Início
  // volta para a página inicial; os demais destinos são seções da
  // página inicial (se estiver noutra página, volta para ela e rola).
  function navigateMain(id: string) {
    if (id === "topo" || id === "inicio") {
      if (appPage !== "inicio") {
        goInicio();
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      return;
    }
    if (id === "painel" || id === "sistema") {
      goPainel();
      return;
    }
    if (id === "vendas") {
      goVendas();
      return;
    }
    if (appPage !== "inicio") {
      goInicio();
      window.setTimeout(() => scrollToId(id), 80);
      return;
    }
    scrollToId(id);
  }

  // ---------- PÁGINA DE ACESSO (#/auth) — página separada ----------
  //
  // Página dedicada e limpa de autenticação: sem TopNav, sem
  // demonstração e sem painel. Entrar ou criar a conta leva direto para
  // a página do painel; "Conhecer o Pingou Venda →" volta para a pública.
  if (appPage === "auth") {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        {sessionChecking ? (
          <main className="mx-auto w-full max-w-md px-4 pb-16 pt-16">
            <img
              src={logoPingcou}
              alt="Pingou Venda"
              className="mx-auto w-[210px] max-w-[70vw]"
            />
            <p className="mt-10 text-center text-sm text-[var(--dim)]">
              Verificando seu acesso…
            </p>
          </main>
        ) : (
          <AuthPage
            mode={authMode}
            onModeChange={setAuthMode}
            profile={sessionCheck.data?.profile ?? null}
            onLogin={handleLoggedIn}
            onAccountCreated={handleAccountSaved}
            onLogout={handleLogout}
            onGoPanel={goPainel}
            onGoHome={goInicio}
          />
        )}
      </div>
    );
  }

  if (activeNiche && loggedIn) {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <TopNav
          onNavigate={navigateFromNiche}
          onAuth={openAuth}
          currentPage={appPage}
        />
        <main>
          <NichePage niche={activeNiche} onBack={() => setNicheView(null)} />
        </main>
        <SiteFooter />
      </div>
    );
  }

  // ---------- PÁGINA DO PAINEL (dashboard) — página separada ----------
  //
  // Esta página é SÓ o painel funcional: métricas, gráficos e os dados
  // do cliente logado (conta, nicho, período grátis). Não tem página
  // inicial, não tem demonstração e não tem nada de vender — registrar
  // venda mora na página de vendas (#/vendas).
  if (appPage === "painel") {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <TopNav
          onNavigate={navigateMain}
          onAuth={openAuth}
          currentPage="painel"
        />
        <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-28 sm:pt-32">
          <div className="mx-auto max-w-3xl">
            <PillBadge>Painel · dashboard</PillBadge>
            <h1 className="t-display mt-4 text-[var(--text)]">
              Seu painel,{" "}
              <span className="font-accent-word">só os números.</span>
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-[var(--dim)]">
              Página separada do painel: faturamento, gráfico, categorias,
              canais e ranking da Gestão e do Marketplace, com os dados da
              sua conta. Aqui não se vende — para registrar venda, abra a
              página de vendas.
            </p>
            <div className="mt-8">
              <PageNav current="painel" onNavigate={goPage} />
            </div>
            {sessionChecking ? (
              <p className="text-center text-sm text-[var(--dim)]">
                Verificando seu acesso…
              </p>
            ) : loggedIn ? (
              <Tracker view="painel" />
            ) : (
              <PageLoginGate
                title="Entre para abrir o seu painel"
                text="O painel de verdade — com as suas vendas, o seu nicho e os seus números — é uma página separada e só aparece para quem entrou na conta. A demonstração fica na página inicial."
                onAuth={openAuth}
                onGoHome={goInicio}
              />
            )}
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  // ---------- PÁGINA DE VENDAS — página separada ----------
  //
  // Esta página é SÓ para vender: registrar venda por seleção (com
  // baixa automática no estoque), montar o estoque e ver a lista
  // completa das vendas. Não tem métrica, gráfico nem ranking — isso é
  // da página do painel (#/painel).
  if (appPage === "vendas") {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <TopNav
          onNavigate={navigateMain}
          onAuth={openAuth}
          currentPage="vendas"
        />
        <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-28 sm:pt-32">
          <div className="mx-auto max-w-3xl">
            <PillBadge>Página de vendas</PillBadge>
            <h1 className="t-display mt-4 text-[var(--text)]">
              Vender e acompanhar{" "}
              <span className="font-accent-word">cada venda.</span>
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-[var(--dim)]">
              Página separada de vendas: registre a venda por seleção, com
              baixa automática no estoque, e veja a lista completa das suas
              vendas, uma por uma. Os números e gráficos ficam na página do
              painel.
            </p>
            <div className="mt-8">
              <PageNav current="vendas" onNavigate={goPage} />
            </div>
            {sessionChecking ? (
              <p className="text-center text-sm text-[var(--dim)]">
                Verificando seu acesso…
              </p>
            ) : loggedIn ? (
              <Tracker view="vendas" />
            ) : (
              <PageLoginGate
                title="Entre para abrir a página de vendas"
                text="A página de vendas de verdade — registrar venda, estoque e a lista das suas vendas — só aparece para quem entrou na conta. Na página inicial tem só a demonstração."
                onAuth={openAuth}
                onGoHome={goInicio}
              />
            )}
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <TopNav onNavigate={navigateMain} onAuth={openAuth} currentPage="inicio" />

      {/* Herói — fundo com grade de pontinhos dourados e brilhos radiais */}
      <div className="hero-top">
        <header className="mx-auto w-full max-w-6xl px-4 pb-14 pt-28 text-center sm:pt-36">
          <img
            src={logoPingcou}
            alt="Pingcou Venda"
            className="mx-auto w-[280px] max-w-[82vw] sm:w-[380px]"
          />
          <div className="mt-7">
            <PillBadge>Gestão de vendas locais · Marketplace para todos os nichos</PillBadge>
          </div>
          <h1 className="t-display mx-auto mt-7 max-w-4xl text-[var(--text)]">
            Gestão para quem vende local.{" "}
            <span className="font-accent-word">Marketplace para todos os nichos.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-[var(--dim)] sm:text-xl">
            Crie sua conta, escolha o seu nicho e acompanhe tudo num painel só:
            a Gestão organiza as vendas locais do dia a dia e o Marketplace abre
            a vitrine para os nichos — imports, vestuário, eletrônicos e muito
            mais.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => openAuth("conta")}
              className="btn-glow w-full rounded-full bg-[var(--accent)] px-8 py-4 text-base font-semibold text-[var(--accent-ink)] sm:w-auto"
            >
              Criar minha conta
            </button>
            <button
              type="button"
              onClick={loggedIn ? goPainel : () => scrollToId("sistema")}
              className="w-full rounded-full border border-[var(--border)] bg-transparent px-8 py-4 text-base font-semibold text-[var(--text)] sm:w-auto"
            >
              {loggedIn ? "Ir para o meu painel" : "Ver a demonstração ↓"}
            </button>
          </div>
          <HeroShowcase />
          <div className="mt-12">
            <PenguinMascot eager />
          </div>
        </header>
      </div>

      {/* Fileiras em movimento */}
      <MarqueeRow
        dark
        items={[
          "Gestão de vendas locais",
          "Marketplace multnicho",
          "Escolha seu nicho",
          "Faturamento em tempo real",
          "Ranking de produtos",
          "Ticket médio",
          "Estoque por nicho",
        ]}
      />

      {/* Acesso: a página pública NÃO tem formulário de cadastro nem de
          login embutido. Aqui ficam só os dois botões — Criar conta e
          Entrar — que abrem a página de autenticação (#/auth). */}
      <section
        id="acesso"
        className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-16 sm:py-20"
      >
        <SectionHeading
          kicker="Crie sua conta ou entre"
          title={
            <>
              Sua conta já nasce{" "}
              <span className="font-accent-word">no seu nicho.</span>
            </>
          }
          sub="Nada de painel genérico igual para todo mundo: ao criar a conta, você escolhe o nicho do seu negócio e o painel já abre organizado — categorias, filtros e textos do seu nicho. Criar conta e entrar acontecem na página de acesso, separada desta demonstração."
        />
        <div className="mx-auto mt-10 flex max-w-xl flex-col items-center justify-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => openAuth("conta")}
            className="btn-glow w-full rounded-full bg-[var(--accent)] px-8 py-4 text-base font-semibold text-[var(--accent-ink)] sm:w-auto"
          >
            Criar conta
          </button>
          <button
            type="button"
            onClick={() => openAuth("entrar")}
            className="w-full rounded-full border border-[var(--border)] bg-transparent px-8 py-4 text-base font-semibold text-[var(--text)] sm:w-auto"
          >
            Entrar
          </button>
        </div>
      </section>

      {/* Páginas do app: a inicial NÃO embute painel nem vendas — cada
          um mora na página dele (#/painel e #/vendas). Aqui ficam só as
          portas de entrada e, para quem não entrou, a demonstração. */}
      <section
        id="sistema"
        className="scroll-mt-20 border-y border-[var(--border)] bg-[var(--surface)] py-16 sm:py-20"
      >
        <div className="mx-auto w-full max-w-6xl px-4">
          <SectionHeading
            kicker="Demonstração do app"
            title={
              <>
                É assim que o seu painel fica —{" "}
                <span className="font-accent-word">por dentro.</span>
              </>
            }
            sub="Esta página é só demonstração: ela mostra o que o app faz, com exemplos visuais — mas não é o painel. O painel de verdade é uma página separada, com as suas vendas e os seus números, e só aparece depois que você entra na sua conta."
          />
          <div className="mx-auto mt-12 max-w-3xl">
            <DemoPanel onAuth={openAuth} />
          </div>
        </div>
      </section>

      {/* Páginas internas dos nichos */}
      <section
        id="nichos"
        className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-16 sm:py-20"
      >
        <SectionHeading
          kicker="Ecossistema de nichos"
          title={
            <>
              Cada nicho,{" "}
              <span className="font-accent-word">sua página.</span>
            </>
          }
          sub="Imports, vestuário e eletrônicos: cada nicho abre numa página própria, com a seleção dele, o estoque que você monta em toques e a venda por seleção — sem digitar produto por produto."
        />
        <div className="mt-12">
          {/* Na página pública o hub de nichos é só demonstração: mostra
              categorias e sugestões do catálogo e o botão leva para a
              página de acesso — nenhum estoque real é lido aqui. */}
          <NicheHub onOpen={openNiche} loggedIn={false} onAuth={openAuth} />
        </div>
      </section>

      {/* A estratégia */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20">
        <SectionHeading
          kicker="A estratégia"
          title={
            <>
              Gestão para o local.{" "}
              <span className="font-accent-word">Marketplace para escalar.</span>
            </>
          }
          sub="Quem vende na cidade precisa de gestão simples e rápida. Quem quer crescer precisa de vitrine. A Pingou Venda junta as duas coisas numa conta só — sem misturar os números de uma frente com os da outra."
        />
        <div className="mt-12">
          <PenguinMascot />
        </div>
        <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-10 border-t border-[var(--border)] pt-8 lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label}>
              <p className="text-5xl font-extrabold tracking-[-0.03em] text-[var(--text)] sm:text-6xl">
                {s.value}
              </p>
              <p className="mt-2 text-sm font-medium text-[var(--dim)]">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Como funciona */}
      <section
        id="como-funciona"
        className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-16 sm:py-20"
      >
        <SectionHeading
          kicker="Como funciona"
          title={
            <>
              Da conta criada{" "}
              <span className="font-accent-word">à decisão certa.</span>
            </>
          }
        />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <article
              key={s.n}
              className="card-glow rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6"
            >
              <p className="font-step-num text-6xl leading-none">{s.n}</p>
              <h3 className="mt-4 text-2xl font-extrabold tracking-tight text-[var(--text)]">
                {s.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
                {s.text}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Método — seção clara alternada */}
      <section id="metodo" className="section-light scroll-mt-24 py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-4">
        <SectionHeading
          kicker="Método"
          title={
            <>
              Organização que começa{" "}
              <span className="font-accent-word">no cadastro.</span>
            </>
          }
          sub="Cinco cuidados que a Pingou Venda toma por você, da criação da conta a cada venda registrada."
        />
        <div className="mt-10 space-y-3">
          {METHOD.map((m, i) => (
            <div
              key={m.title}
              className="card-glow card-light grid gap-1 rounded-[var(--radius)] p-5 sm:grid-cols-[64px_1fr_1.4fr] sm:items-baseline sm:gap-4 sm:p-6"
            >
              <span className="font-step-num text-[26px] leading-none">
                0{i + 1}
              </span>
              <h3 className="text-2xl font-extrabold tracking-tight text-[var(--text)]">{m.title}</h3>
              <p className="text-base leading-relaxed text-[var(--dim)]">{m.text}</p>
            </div>
          ))}
        </div>
        </div>
      </section>

      {/* Linha do tempo */}
      <section className="border-y border-[var(--border)] bg-[var(--surface)] py-16 text-[var(--text)] sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-4">
          <div className="mx-auto max-w-3xl text-center">
            <PillBadge>Sua rotina na Pingou Venda</PillBadge>
            <h2 className="t-display mt-4">
              O painel acompanha o seu dia,{" "}
              <span className="font-accent-word">não o contrário.</span>
            </h2>
          </div>
          <div className="mt-12 grid gap-10 lg:grid-cols-[240px_1fr]">
            <p className="text-lg font-bold tracking-tight">
              Da conta criada
              <br />
              <span className="font-normal opacity-60">ao mês fechado</span>
            </p>
            <ol>
              {TIMELINE.map((t, i) => (
                <li
                  key={t.title}
                  className={`grid gap-1 py-5 sm:grid-cols-[130px_1fr_1.3fr] sm:items-baseline sm:gap-4 ${
                    i === 0 ? "border-t border-white/25" : "border-t border-white/15"
                  }`}
                >
                  <span className="inline-flex w-fit items-center rounded-full border border-white/30 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                    {t.label}
                  </span>
                  <h3 className="text-xl font-extrabold tracking-tight">
                    {t.title}
                  </h3>
                  <p className="text-base leading-relaxed opacity-75">{t.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Benefícios — seção clara alternada */}
      <section className="section-light py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-4">
        <SectionHeading
          kicker="Benefícios"
          title={
            <>
              Por que vender{" "}
              <span className="font-accent-word">com a Pingou Venda.</span>
            </>
          }
          sub="Gestão local sem complicação, marketplace sem fronteira de nicho — e os números dos dois, separados e claros."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {BENEFITS.map((b) => (
            <article
              key={b.title}
              className="card-glow rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8"
            >
              <h3 className="text-2xl font-extrabold tracking-tight text-[var(--text)]">
                {b.title}
              </h3>
              <p className="mt-2 text-base leading-relaxed text-[var(--dim)]">
                {b.text}
              </p>
            </article>
          ))}
        </div>
        </div>
      </section>

      {/* Comparativo */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20">
        <SectionHeading
          kicker="Comparativo"
          title={
            <>
              A diferença está na{" "}
              <span className="font-accent-word">organização.</span>
            </>
          }
        />
        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          <article className="card-glow rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
            <h3 className="text-2xl font-extrabold tracking-tight text-[var(--dim)]">
              De cabeça, sem sistema
            </h3>
            <ul className="mt-5 space-y-3.5">
              {COMPARE_OLD.map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-base text-[var(--dim)]">
                  <span className="text-[var(--danger)]">
                    <IconX />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </article>
          <article className="card-glow gradient-purple-bg rounded-[var(--radius-xl)] border border-[var(--accent)] p-6 text-[var(--accent-ink)] sm:p-8">
            <h3 className="text-2xl font-extrabold tracking-tight">Na Pingou Venda</h3>
            <ul className="mt-5 space-y-3.5">
              {COMPARE_NEW.map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-base">
                  <span className="text-[var(--accent-ink)]">
                    <IconCheck />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      {/* FAQ — seção clara alternada */}
      <section id="faq" className="section-light scroll-mt-24 py-16 sm:py-20">
        <div className="mx-auto w-full max-w-3xl px-4">
        <SectionHeading
          kicker="FAQ"
          title="Perguntas frequentes"
          sub="A estratégia, a conta e o painel — sem enrolação."
        />
        <div className="card-glow mt-8 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-5">
          {FAQS.map((f) => (
            <FaqItem key={f.q} q={f.q} a={f.a} />
          ))}
        </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-16">
        <div className="mb-10">
          <PenguinMascot />
        </div>
        <div className="card-glow gradient-purple-bg rounded-[var(--radius-xl)] border border-[var(--accent)] px-6 py-14 text-center text-[var(--accent-ink)] sm:py-16">
          <span className="pill-badge">
            <span className="pill-icon">
              <IconSpark />
            </span>
            Comece agora
          </span>
          <h2 className="t-display mx-auto mt-4 max-w-2xl">
            Crie sua conta, escolha seu nicho e veja a primeira venda{" "}
            <span className="text-white underline decoration-white/50 underline-offset-4">pingar.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed opacity-80">
            Gestão para as vendas locais, Marketplace para todos os nichos —
            num painel só.
          </p>
          <button
            type="button"
            onClick={() => openAuth("conta")}
            className="mt-8 rounded-full bg-[var(--bg)] px-8 py-4 text-base font-semibold text-[var(--text)]"
          >
            Criar minha conta
          </button>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
