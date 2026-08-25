import { useState } from "react";

export default function Page() {
  const [count, setCount] = useState(0);

  return (
    <html>
      <head>
        <title>Home page</title>
      </head>
      <body>
        <main>
          <h1>Hello header</h1>
          <p>Hello paragraph</p>
          <button onClick={() => setCount((c) => c + 1)}>
            Current: {count}
          </button>
        </main>
      </body>
    </html>
  );
}
