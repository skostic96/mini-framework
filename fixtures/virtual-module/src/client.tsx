import App from './App';
import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import {
  QueryClientProvider,
  QueryClient,
  hydrate,
  type DehydratedState,
} from '@tanstack/react-query';
import './styles.css';

declare global {
  interface Window {
    __RQ__: DehydratedState[];
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
    },
  },
});

const RQ = (window.__RQ__ ||= []);
RQ.forEach((dehydratedState) => {
  console.log('found existing data to hydrate on client');
  hydrate(queryClient, dehydratedState);
});
RQ.push = (dehydratedState) => {
  console.log('new data to hydrate on query client');
  hydrate(queryClient, dehydratedState);
  return 0;
};

function digestOf(error: unknown): string | null {
  if (
    error instanceof Error &&
    'digest' in error &&
    typeof error.digest === 'string'
  ) {
    return error.digest;
  }
  return null;
}

hydrateRoot(
  document,
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
  {
    onRecoverableError(error, errorInfo) {
      console.warn(digestOf(error), error, errorInfo);
    },
  },
);

if (import.meta.webpackHot) {
  console.log('current hash:', __webpack_hash__);
  import.meta.webpackHot.addStatusHandler((status) =>
    console.log('[hmr status]', status, __webpack_hash__),
  );
}
