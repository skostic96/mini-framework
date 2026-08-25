import { renderToStaticMarkup } from 'react-dom/server';

const page = (
  <html>
    <head>
      <title>A page title</title>
    </head>
    <body>
      <h1>A page header</h1>
      <p>A page paragraph</p>
    </body>
  </html>
);

console.log(renderToStaticMarkup(page));
