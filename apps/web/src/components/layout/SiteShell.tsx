// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { Outlet } from 'react-router-dom';
import { CinderRouteRegistry } from '@/components/cinder/CinderRouteRegistry';
import { CinderSdkBootstrap } from '@/components/cinder/CinderSdkBootstrap';
import { Footer } from './Footer';
import { Header } from './Header';

export function SiteShell() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <CinderSdkBootstrap />
      <CinderRouteRegistry />
      <a
        href="#main-content"
        className="sr-only absolute left-4 top-4 z-[60] rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only dark:bg-white dark:text-slate-950"
      >
        Skip to content
      </a>
      <Header />
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
