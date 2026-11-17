// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { bootWebCinder } from '@/lib/cinder/runtime';

export function CinderSdkBootstrap() {
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    let scanFrameId: number | undefined;

    if (!cancelled) {
      scanFrameId = window.requestAnimationFrame(() => {
        void bootWebCinder(document).catch((error) => {
          console.error('[cinder] failed to initialize docs runtime', error);
        });
      });
    }

    return () => {
      cancelled = true;

      if (typeof scanFrameId === 'number') {
        window.cancelAnimationFrame(scanFrameId);
      }
    };
  }, [location.pathname, location.search]);

  return null;
}
