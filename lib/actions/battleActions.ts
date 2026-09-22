'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import type { ItemType } from '@/lib/actions/types';

export async function performAttackAction(itemType: ItemType) {
  const headerStore = await headers();
  const fallbackUid = '00000000-0000-0000-0000-000000000000';
  const userId = headerStore.get('x-user-id') ?? fallbackUid;

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/action/attack`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer uid:${userId}`,
        Cookie: `uid=${userId}`,
      },
      body: JSON.stringify({
        item_type: itemType,
        nonce: randomUUID(),
      }),
      cache: 'no-store',
    }
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Attack failed: ${errorBody}`);
  }

  const result = await res.json();

  // 强制 Next.js 重新验证服务端组件的数据
  revalidatePath('/');

  return result;
}
