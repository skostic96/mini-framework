import { hydrateRoot } from "react-dom/client";

type Factory = () => { default: React.ComponentType<any> };
type Entry = [route: string, factory?: Factory];

declare global {
  interface Window {
    __INITIAL_DATA__: Record<string, unknown>;
    __FRAMEWORK_P__: Entry[];
  }
}

const registered = new Map<string, Factory>();
const waiting = new Map<string, (f: Factory) => void>();

function register([route, factory]) {
  // HMR path, registering route without factory, triggers delete
  if (!factory) {
    // in case it was registered, but new factory not provided
    registered.delete(route);
    return;
  }
  registered.set(route, factory);
  const resolve = waiting.get(route);
  if (resolve) {
    waiting.delete(route);
    resolve(factory);
  }
}

function whenPage(route: string): Promise<Factory> {
  const existing = registered.get(route);
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve) => {
    waiting.set(route, resolve);
  });
}

const queue = (window.__FRAMEWORK_P__ = window.__FRAMEWORK_P__ || []);
// register each existing page from the queue
queue.forEach(register);
// then clear the queue by setting length to 0
queue.length = 0;
// replace each future push with register function
queue.push = register as any;

async function bootstrap() {
  const data = window.__INITIAL_DATA__;
  const Page = (await whenPage(data.pageRoute as string))().default;
  hydrateRoot(document, <Page />);
}

bootstrap().catch((error) => {
  console.error("Failed to bootstrap page", error);
});
