import { useState, Suspense } from 'react';
import Layout from './Layout';
import { useSuspenseQuery } from '@tanstack/react-query';

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <Layout>
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
        <Todo id={1} />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <Todo id={2} />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <Todo id={3} />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <Todo id={4} />
      </Suspense>
    </Layout>
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

interface Todo {
  userId: number;
  id: number;
  title: string;
  completed: boolean;
}

const fetchPost =
  (option: { id: number }) =>
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

function Todo(props: { id: number }) {
  const { data } = useSuspenseQuery({
    queryKey: ['todos', props.id],
    queryFn: fetchPost({ id: props.id }),
  });

  return (
    <p>
      {data.title} - {data.completed ? 'done' : 'open'}
    </p>
  );
}
