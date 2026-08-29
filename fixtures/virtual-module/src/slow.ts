export default function slow<T = unknown>(
  option: { data?: T; resolver?: Promise<T> },
  timeout = 5000,
): Promise<T> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      if (option.resolver) {
        return option.resolver.then(resolve, reject);
      }
      if (option.data) {
        return resolve(option.data);
      }
      resolve({} as T);
    }, timeout),
  );
}
