import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cinder } from 'usecinder';
import { createWebCinderRouteDefinitions } from '@/lib/cinder/routes';

export function CinderRouteRegistry() {
  const navigate = useNavigate();
  const routes = useMemo(
    () => createWebCinderRouteDefinitions((path) => navigate(path)),
    [navigate],
  );

  useEffect(() => {
    for (const route of routes) {
      Cinder.registerRoute(route);
    }

    return () => {
      for (const route of routes) {
        Cinder.unregisterRoute(route.key);
      }
    };
  }, [routes]);

  return null;
}
