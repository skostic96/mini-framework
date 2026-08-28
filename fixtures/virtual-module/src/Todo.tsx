import { useSuspenseQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import styles from './Todo.module.css';

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

export default function Todo(props: { id?: string }) {
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
          <span className={styles.color}>{data.title}</span>
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
