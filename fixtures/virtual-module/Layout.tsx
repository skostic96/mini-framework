export default function Layout(props: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <title></title>
      </head>
      <body>{props.children}</body>
    </html>
  );
}
