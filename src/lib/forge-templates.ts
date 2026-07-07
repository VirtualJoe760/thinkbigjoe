// The template library the owner can pick from in the portal. Mirrors
// webdev-templates/templates/registry.json (a separate repo the forge lives in, so it
// can't be imported at runtime — keep this list in sync when templates are added/retired).
// The forge (forge-build.sh) niche-matches by default; this lets a claimed owner override.

export type ForgeTemplate = {
  id: string;
  name: string;
  description: string;
  bestFor: string;
};

export const FORGE_TEMPLATES: ForgeTemplate[] = [
  {
    id: "frontend-base",
    name: "Classic Service",
    description: "Balanced and versatile — the safe all-rounder.",
    bestFor: "Any local service business.",
  },
  {
    id: "bold-trades",
    name: "Bold Trades",
    description: "Dark, high-contrast, muscular. Dependable and no-nonsense.",
    bestFor: "HVAC, electrical, plumbing, garage doors, auto, welding.",
  },
  {
    id: "premium-service",
    name: "Premium Service",
    description: "Editorial, calm, high-end — a craftsman worth more.",
    bestFor: "Roofing, remodeling, builders, landscaping, pools, tile.",
  },
  {
    id: "friendly-local",
    name: "Friendly Local",
    description: "Warm, approachable, human — a neighbor you'd let in.",
    bestFor: "Cleaning, handyman, lawn care, pet services, moving.",
  },
  {
    id: "clean-corporate",
    name: "Clean Corporate",
    description: "Crisp, structured, professional — a company with process.",
    bestFor: "Pest control, security, IT/MSP, inspection, commercial.",
  },
  {
    id: "modern-tech",
    name: "Modern Tech",
    description: "Sleek, gradient, premium-modern.",
    bestFor: "Solar, smart-home, EV, med-spa, modern dental, detailing.",
  },
];

export const FORGE_TEMPLATE_IDS = FORGE_TEMPLATES.map((t) => t.id);

export function isForgeTemplate(id: string): boolean {
  return FORGE_TEMPLATE_IDS.includes(id);
}
