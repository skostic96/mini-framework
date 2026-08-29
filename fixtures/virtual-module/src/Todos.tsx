import { Suspense } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { loadable } from './ctx';
import Loading from './Loading';
import slow from './slow';

const TodosSlowFoo = loadable(
  () => import(/* webpackChunkName: "TodosSlowFoo" */ './TodosSlowFoo'),
  'TodosSlowFoo',
);

interface Todo {
  userId: number;
  id: number;
  title: string;
  completed: boolean;
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

export default function Todos() {
  const [searchParams] = useSearchParams();

  const limit: string = searchParams.get(QUERY_PARAM.LIMIT) ?? DEFAULT_LIMIT;

  const params = new URLSearchParams();
  params.set(QUERY_PARAM.LIMIT, limit);

  const { data } = useSuspenseQuery({
    queryKey: ['todos', QUERY_PARAM.LIMIT],
    queryFn: ({ signal }) =>
      slow({ resolver: fetchTodos(params)({ signal }) }, 2000),
  });

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-3xl font-bold tracking-tight text-slate-900">
        Todos :)
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

      <Suspense fallback={<Loading />}>
        <TodosSlowFoo />
      </Suspense>
    </main>
  );
}
