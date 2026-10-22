/**
 * Demo showcase catalog (Óptica Nova Vision). Static and clearly labeled as demo in the UI:
 * the real catalog (products, product_variants, inventory_levels per branch) ships in Phase 4
 * and will feed this same <Showcase/> component.
 */
/** `stage`: top/bottom edge colors measured from the photo, so the stage blends with it seamlessly. */
export interface FrameColor { key: string; name: string; swatch: string; image: string; stage: [string, string] }
export interface FrameModel {
  slug: string;
  name: string;
  collection: string;
  category: "Oftálmica" | "Sol";
  shape: string;
  material: string;
  description: string;
  sku: string;
  size: { lens: number; bridge: number; temple: number };
  price: number;
  colors: FrameColor[];
  tags: string[];
}

export const DEMO_CATALOG: FrameModel[] = [
  {
    slug: "aurora", name: "Aurora", collection: "Atelier 2026", category: "Oftálmica", shape: "Cat-eye", material: "Acetato bicapa",
    description: "Un cat-eye contemporáneo con doble capa de acetato: color al frente, blanco por dentro. Ligero, cómodo y compatible con lentes progresivos.",
    sku: "NV-AUR-52", size: { lens: 52, bridge: 18, temple: 140 }, price: 485000, tags: ["Progresivos", "Bisagra flex"],
    colors: [
      { key: "cobalto", name: "Azul cobalto", swatch: "#1d4ed8", image: "/frames/aurora-cobalto.jpg", stage: ["#dcdcde", "#ced0d2"] },
      { key: "negro", name: "Negro", swatch: "#0f0f12", image: "/frames/aurora-negro.jpg", stage: ["#d7dadf", "#c4c8cd"] },
      { key: "havana", name: "Havana", swatch: "#9a4d16", image: "/frames/aurora-havana.jpg", stage: ["#dadade", "#c8cacd"] },
      { key: "rosa", name: "Rosa cristal", swatch: "#f3b4b0", image: "/frames/aurora-rosa.jpg", stage: ["#d8d8db", "#c9cbce"] },
      { key: "esmeralda", name: "Esmeralda", swatch: "#0f6b47", image: "/frames/aurora-esmeralda.jpg", stage: ["#dddce0", "#cbccce"] },
    ],
  },
  {
    slug: "milano", name: "Milano", collection: "Titanium", category: "Oftálmica", shape: "Redonda", material: "Titanio",
    description: "Aro redondo ultradelgado en titanio con plaquetas ajustables. Apenas 9 gramos.",
    sku: "NV-MIL-49", size: { lens: 49, bridge: 21, temple: 145 }, price: 690000, tags: ["Hipoalergénica", "9 g"],
    colors: [{ key: "oro", name: "Oro", swatch: "#c9a45c", image: "/frames/milano-oro.jpg", stage: ["#c5c4c7", "#b2b1b4"] }],
  },
  {
    slug: "soho", name: "Soho", collection: "Urbana", category: "Oftálmica", shape: "Rectangular", material: "Acetato",
    description: "Rectangular de perfil grueso y presencia fuerte. Ideal para lentes de alto índice.",
    sku: "NV-SOH-51", size: { lens: 51, bridge: 20, temple: 145 }, price: 420000, tags: ["Alto índice"],
    colors: [{ key: "negro", name: "Negro brillante", swatch: "#111114", image: "/frames/soho-negro.jpg", stage: ["#d6d5d6", "#c6c6c6"] }],
  },
  {
    slug: "panto", name: "Panto", collection: "Clásicos", category: "Oftálmica", shape: "Panto", material: "Acetato",
    description: "La forma panto de siempre, en havana cálido. Favorece a casi todos los rostros.",
    sku: "NV-PAN-48", size: { lens: 48, bridge: 21, temple: 145 }, price: 390000, tags: ["Unisex"],
    colors: [{ key: "havana", name: "Havana", swatch: "#7a3e14", image: "/frames/panto-havana.jpg", stage: ["#dcdbdd", "#bebdbf"] }],
  },
  {
    slug: "cristal", name: "Cristal", collection: "Urbana", category: "Oftálmica", shape: "Cuadrada", material: "Acetato transparente",
    description: "Cuadrada y transparente: protagonismo para los ojos, no para la montura.",
    sku: "NV-CRI-52", size: { lens: 52, bridge: 19, temple: 145 }, price: 360000, tags: ["Filtro azul recomendado"],
    colors: [{ key: "transparente", name: "Transparente", swatch: "#e9eef2", image: "/frames/cristal-transparente.jpg", stage: ["#dddcde", "#bdbec0"] }],
  },
  {
    slug: "riviera", name: "Riviera", collection: "Sol 2026", category: "Sol", shape: "Oversize", material: "Acetato y metal",
    description: "Gafa de sol oversize con lente degradado y detalles dorados. Protección UV400.",
    sku: "NV-RIV-58", size: { lens: 58, bridge: 17, temple: 140 }, price: 540000, tags: ["UV400", "Degradado"],
    colors: [{ key: "rosa", name: "Rosa degradado", swatch: "#e8909a", image: "/frames/riviera-rosa.jpg", stage: ["#d3d2d3", "#c7c5c6"] }],
  },
];
