import { useState, Suspense, use } from 'react';
import Layout from './Layout';

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
    </Layout>
  );
}

function Loading() {
  return <p>Loading...</p>;
}

function Post() {
  const post = use(
    fetch('https://jsonplaceholder.typicode.com/todos/1')
      .then((res) => res.json())
      .then(
        (d) => new Promise((resolve) => setTimeout(() => resolve(d), 5000)),
      ),
  );

  return <pre>{JSON.stringify(post, null, 2)}</pre>;
}
