import { useState, Suspense } from 'react';
import Layout from './Layout';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, Routes, Route, useSearchParams, useParams } from 'react-router';
// todo: maybe we can have autocomplete for available classnames from css modules?
import styles from './App.module.css';

export default function App() {
  return (
    <Layout>
      <nav>
        <ul className={styles.list}>
          <li className={styles.link}>
            <Link to="/">Home</Link>
          </li>
          <li>
            <Link to="/todos">Todos</Link>
          </li>
        </ul>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/todos"
          element={
            <>
              <Suspense fallback={<Loading />}>
                <Todos />
              </Suspense>
              <Suspense fallback={<Loading />}>
                <Todo id="20" />
              </Suspense>
              <Suspense fallback={<Loading />}>
                <Todo id="21" />
              </Suspense>
              <Suspense fallback={<Loading />}>
                <Todo id="22" />
              </Suspense>
              <Suspense fallback={<Loading />}>
                <Todo id="23" />
              </Suspense>
            </>
          }
        />
        <Route
          path="/todos/:id"
          element={
            <Suspense fallback={<Loading />}>
              <Todo />
            </Suspense>
          }
        />
      </Routes>
    </Layout>
  );
}

function Home() {
  const [count, setCount] = useState(0);

  return (
    <main>
      <h1>Hey</h1>
      <p>Hello world</p>
      <p>Hello, what the fuck?</p>
      <p>Something else...</p>
      <code>Hello World</code>
      <p>What the fuck are you doing mate?</p>
      <button onClick={() => setCount((c) => c + 1)}>Count {count}</button>
      <Suspense fallback={<Loading />}>
        <Post />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <Todo id="1" />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <Todo id="2" />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <Todo id="3" />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <Todo id="4" />
      </Suspense>
    </main>
  );
}

function Loading() {
  return <p>Loading...</p>;
}

function ErrorInfo(props: { message: string }) {
  return <p>{props.message}</p>;
}

function Post() {
  const { data } = useSuspenseQuery({
    queryKey: ['post', 2],
    queryFn: ({ signal }) =>
      fetch('https://jsonplaceholder.typicode.com/todos/1', { signal })
        .then((res) => res.json())
        .then(
          (d) => new Promise((resolve) => setTimeout(() => resolve(d), 5000)),
        ),
  });

  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}

const fetchTodos =
  (params: URLSearchParams) =>
  async ({ signal }) => {
    const res = await fetch(
      `https://jsonplaceholder.typicode.com/todos?${params.toString()}`,
      { signal },
    );
    if (!res.ok) {
      throw `HTTP: ${res.status} - ${res.statusText}`;
    }
    return (await res.json()) as Todo[];
  };

const DEFAULT_LIMIT = '10';
const QUERY_PARAM = {
  LIMIT: '_limit',
};

function Todos() {
  const [searchParams] = useSearchParams();

  const limit: string = searchParams.get(QUERY_PARAM.LIMIT) ?? DEFAULT_LIMIT;

  const params = new URLSearchParams();
  params.set(QUERY_PARAM.LIMIT, limit);

  const { data } = useSuspenseQuery({
    queryKey: ['todos', QUERY_PARAM.LIMIT],
    queryFn: fetchTodos(params),
  });

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-3xl font-bold tracking-tight text-slate-900">
        Todos
      </h1>

      <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {data.map((todo) => (
          <li key={todo.id}>
            <Link
              to={String(todo.id)}
              className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500">
                  {todo.id}
                </span>
                <span className="truncate text-sm text-slate-800">
                  {todo.title}
                </span>
              </div>

              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                  todo.completed
                    ? 'bg-green-100 text-green-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
              >
                {todo.completed ? '✅ Done' : '⏳ Pending'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

interface Todo {
  userId: number;
  id: number;
  title: string;
  completed: boolean;
}

const fetchTodo =
  (option: { id: string }) =>
  async ({ signal }) => {
    const res = await fetch(
      `https://jsonplaceholder.typicode.com/todos/${option.id}`,
      { signal },
    );
    if (!res.ok) {
      throw `HTTP: ${res.status} - ${res.statusText}`;
    }
    return (await res.json()) satisfies Todo;
  };

function Todo(props: { id?: string }) {
  const { id } = useParams<{ id?: string }>();
  const ID = props.id ?? id ?? '1';

  const { data } = useSuspenseQuery({
    queryKey: ['todos', ID],
    queryFn: fetchTodo({ id: ID }),
  });

  return (
    <article className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-start justify-between gap-4">
        <h2 className="text-lg font-semibold leading-snug text-slate-900">
          {data.title}
        </h2>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            data.completed
              ? 'bg-green-100 text-green-700'
              : 'bg-amber-100 text-amber-700'
          }`}
        >
          {data.completed ? 'Done' : 'Open'}
        </span>
      </header>

      <dl className="divide-y divide-slate-100 text-sm">
        <div className="flex justify-between py-2">
          <dt className="text-slate-500">ID</dt>
          <dd className="font-mono text-slate-900">{data.id}</dd>
        </div>
        <div className="flex justify-between py-2">
          <dt className="text-slate-500">User ID</dt>
          <dd className="font-mono text-slate-900">{data.userId}</dd>
        </div>
        <div className="flex justify-between gap-6 py-2">
          <dt className="shrink-0 text-slate-500">Title</dt>
          <dd className="text-right text-slate-900">{data.title}</dd>
        </div>
        <div className="flex justify-between py-2">
          <dt className="text-slate-500">Completed</dt>
          <dd className="text-slate-900">{String(data.completed)}</dd>
        </div>
      </dl>
    </article>
  );
}
