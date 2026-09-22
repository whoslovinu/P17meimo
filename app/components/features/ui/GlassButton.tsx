'use client';

import { motion } from 'framer-motion';
import type { ComponentProps, ReactNode } from 'react';

type GlassButtonProps = ComponentProps<typeof motion.button> & {
  children: ReactNode;
};

export function GlassButton({ children, className = '', ...props }: GlassButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      className={`rounded-xl border border-border-glass bg-surface-glass px-4 py-2 text-sm font-semibold text-white backdrop-blur-md transition-colors hover:border-white/20 ${className}`}
      {...props}
    >
      {children}
    </motion.button>
  );
}
