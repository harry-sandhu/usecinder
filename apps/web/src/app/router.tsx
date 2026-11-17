// Copyright (c) 2026 harry-sandhu. Licensed under the Elastic License 2.0 (ELv2).
// See LICENSE and NOTICE in the repository root. Do not remove this notice.
import { createBrowserRouter } from 'react-router-dom';
import { DocsShell } from '@/components/layout/DocsShell';
import { SiteShell } from '@/components/layout/SiteShell';
import { HomePage } from '@/pages/HomePage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { DocsPage } from '@/pages/docs/DocsPage';
import { RelayAuthPage } from '@/pages/relay/RelayAuthPage';
import { RelayDashboardPage } from '@/pages/relay/RelayDashboardPage';
import { RelayLandingPage } from '@/pages/relay/RelayLandingPage';
import { BlogIndexPage } from '@/pages/blog/BlogIndexPage';
import { BlogPostPage } from '@/pages/blog/BlogPostPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <SiteShell />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: 'docs',
        element: <DocsShell />,
        children: [
          {
            index: true,
            element: <DocsPage />,
          },
          {
            path: '*',
            element: <DocsPage />,
          },
        ],
      },
      {
        path: 'relay',
        element: <RelayLandingPage />,
      },
      {
        path: 'relay/login',
        element: <RelayAuthPage />,
      },
      {
        path: 'relay/dashboard',
        element: <RelayDashboardPage />,
      },
      {
        path: 'blog',
        element: <BlogIndexPage />,
      },
      {
        path: 'blog/:slug',
        element: <BlogPostPage />,
      },
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
]);
