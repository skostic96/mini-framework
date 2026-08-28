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
    <main>
      <h1>Todos</h1>
      <ul>
        {data.map((todo) => {
          return (
            <li key={todo.id}>
              <Link to={String(todo.id)}>
                <div>
                  {todo.id} : {todo.title}
                </div>
                <div>{todo.completed ? '✅ Done' : '⏳ Pending'}</div>
              </Link>
            </li>
          );
        })}
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
    <p>
      {data.title} - {data.completed ? 'done' : 'open'}
    </p>
  );
}
