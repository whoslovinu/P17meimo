export const physics = {
  springInteraction: { type: "spring", stiffness: 400, damping: 25, mass: 0.8 }, // Precise physics definitions [cite: 7]
  springImpact: { type: "spring", stiffness: 300, damping: 15, mass: 1.2 }, // Precise physics definitions [cite: 7]
} as const;
