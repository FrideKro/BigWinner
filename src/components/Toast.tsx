'use client';

import React from 'react';

export function Toast({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 z-[80] -translate-x-1/2 bottom-[calc(6rem+env(safe-area-inset-bottom))] w-max max-w-[calc(100vw-2rem)] rounded-2xl bg-slate-900/95 px-4 py-2.5 text-center text-sm text-white shadow-lg backdrop-blur"
    >
      {message}
    </div>
  );
}
