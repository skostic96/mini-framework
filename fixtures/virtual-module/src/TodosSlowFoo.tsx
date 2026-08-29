import slow from './slow';
import styles from './TodosSlowFoo.module.css';
import { useSuspenseQuery } from '@tanstack/react-query';

export default function TodosSlowFoo() {
  const { data } = useSuspenseQuery({
    queryKey: ['todos-slow-foo'],
    queryFn: () =>
      slow({
        data: {
          title: 'Todos slow foo, loaded after parent suspense boundary',
          content: ['This is first sentence', 'This is second sentence'],
        },
      }),
  });

  return (
    <section>
      <h2 className={styles.title}>{data.title}</h2>
      {data.content.map((s) => (
        <p key={s} className={styles.paragraph}>
          {s}
        </p>
      ))}
    </section>
  );
}
