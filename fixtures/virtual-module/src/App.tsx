import { useState, Suspense } from 'react';
import Layout from './Layout';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link, Routes, Route, useSearchParams, useParams } from 'react-router';
import Loading from './Loading';
// todo: maybe we can have autocomplete for available classnames from css modules?
import styles from './App.module.css';
import { loadable } from './ctx';

const Todos = loadable(
  () => import(/* webpackChunkName: "todos" */ './Todos'),
  'todos',
);
const Todo = loadable(
  () => import(/* webpackChunkName: "todo" */ './Todo'),
  'todo',
);

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
    </main>
  );
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
