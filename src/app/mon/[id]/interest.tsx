'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChatsCircleIcon, HeartIcon } from '@phosphor-icons/react/ssr';
import { ATTENTION_EVENT } from '@/components/nav';
import { Notice, buttonClass } from '@/components/ui';
import { swipeAction } from '@/app/quet/actions';

// Nút "Quan tâm" ở trang món: cùng một lượt quẹt như ở màn Quẹt (hàm swipe_item), nên giới hạn và luật khớp như nhau.

type State = { liked: boolean; matchId: string | null };

export function InterestButton({ itemId, ownerName, initial }: { itemId: string; ownerName: string; initial: State }) {
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const [justMatched, setJustMatched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const like = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    let outcome: Awaited<ReturnType<typeof swipeAction>>;
    try {
      outcome = await swipeAction(itemId, 'like');
    } catch {
      outcome = { ok: false, code: 'error', message: 'Mất kết nối. Thử lại nhé.' };
    }
    setPending(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setState({ liked: true, matchId: outcome.matchId });
    if (outcome.isNew) {
      setJustMatched(true);
      window.dispatchEvent(new Event(ATTENTION_EVENT));
    }
  };

  if (state.matchId) {
    return (
      <div className="space-y-2">
        {justMatched && <Notice tone="ok" title="Khớp rồi!">Bạn và {ownerName} đều quan tâm món của nhau.</Notice>}
        <Link href={`/khop/${state.matchId}`} className={buttonClass('primary', 'lg', 'w-full')}>
          <ChatsCircleIcon size={20} weight="bold" aria-hidden /> Nhắn tin với {ownerName}
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <button type="button" onClick={() => void like()} disabled={pending || state.liked} className={buttonClass(state.liked ? 'secondary' : 'primary', 'lg', 'w-full')}>
        <HeartIcon size={20} weight={state.liked ? 'fill' : 'bold'} aria-hidden />
        {state.liked ? 'Đã quan tâm' : pending ? 'Đang ghi...' : 'Quan tâm'}
      </button>
      {error ? (
        <Notice tone="warn">{error}</Notice>
      ) : (
        <p className="text-center text-sm text-muted" role="status">
          {state.liked
            ? `Khi ${ownerName} cũng quan tâm một món của bạn, hai người sẽ khớp và nhắn tin được.`
            : 'Quan tâm là bước đầu: hai bên cùng quan tâm món của nhau thì khớp.'}
        </p>
      )}
    </div>
  );
}
