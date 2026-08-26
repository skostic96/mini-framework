import App from './App';
import { hydrateRoot } from 'react-dom/client';

hydrateRoot(document, <App />);

if (import.meta.webpackHot) {
  console.log('current hash:', __webpack_hash__);
  import.meta.webpackHot.addStatusHandler((status) =>
    console.log('[hmr status]', status, __webpack_hash__),
  );
}
