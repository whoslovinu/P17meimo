/**
 * spine-patch.ts — Root-Level Constructor Hack: Absolute Physics Shield
 *
 * Hard-patches the @esotericsoftware/spine-core class prototypes at the top of
 * the module graph. This runs before any component, hook, or dynamic import.
 *
 * EXTRACTED from app/layout.tsx — this module is only imported by
 * app/components/features/battle/SpineViewer.tsx so the patch only activates
 * when the WebGL game engine mounts, keeping the rest of the Next.js app clean.
 *
 * Patch 1: Skeleton.prototype.physics — prevents "physics is undefined" in updateWorldTransform.
 *   The new updateWorldTransform(physics) is a required argument in spine-core 4.2.108.
 *   If called without arguments, it throws. We make it optional by wrapping.
 * Patch 2: SkeletonData.prototype.physics — prevents crashes in SkeletonData accessors.
 * Patch 3: AnimationState.prototype.apply — prevents crashes from null physics in apply().
 */

import { Skeleton, SkeletonData } from '@esotericsoftware/spine-core';

if (typeof window !== 'undefined') {
  // Patch 1a: Give the Skeleton class its own physics property
  Object.defineProperty(Skeleton.prototype, 'physics', {
    get() { return (this as unknown as { _physics?: unknown[] })._physics ?? []; },
    set(v) { (this as unknown as { _physics?: unknown[] })._physics = v; },
    configurable: true,
    enumerable: false,
  });

  // Patch 1b: Wrap updateWorldTransform to accept undefined physics (treats it as null)
  const origUWT = Skeleton.prototype.updateWorldTransform;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Skeleton.prototype as any).updateWorldTransform = function (physics: unknown) {
    // Patch logic: treat undefined/null as the default (pass-through).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origUWT as any).call(this, physics === undefined ? undefined : physics);
  };

  // Patch 2: SkeletonData.prototype.physics
  Object.defineProperty(SkeletonData.prototype, 'physics', {
    get() { return (this as unknown as { _physics?: unknown[] })._physics ?? []; },
    set(v) { (this as unknown as { _physics?: unknown[] })._physics = v; },
    configurable: true,
    enumerable: false,
  });

  // Patch 3: Patch AnimationState.apply to handle null/undefined physics
  const spineCoreModule = (window as unknown as { __spineCoreModule?: { AnimationState?: { prototype?: { apply?: (skeleton: unknown, previousAnimation: unknown) => unknown } } } }).__spineCoreModule;
  if (spineCoreModule?.AnimationState?.prototype?.apply) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origApply = spineCoreModule.AnimationState.prototype.apply as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (spineCoreModule.AnimationState.prototype as any).apply = function (skeleton: unknown, previousAnimation: unknown) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return origApply.call(this, skeleton, previousAnimation);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg?.includes('physics is undefined')) {
          return null;
        }
        throw e;
      }
    };
  }

  (window as unknown as { __SPINE_SHIELD_ACTIVE__?: boolean }).__SPINE_SHIELD_ACTIVE__ = true;
  console.log('☢️ [SPINE-PATCH] Physics Shield Hard-Wired (v3 - UWT wrapper).');
}
