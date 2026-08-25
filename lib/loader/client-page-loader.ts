import type { LoaderDefinitionFunction } from "@rspack/core";
import z from "zod";

const LoaderOptionsSchema = z.object({
  pageAbsolutePath: z.string(),
  pageRoute: z.string(),
});

type ClientPageLoaderOptions = z.infer<typeof LoaderOptionsSchema>;

const loader: LoaderDefinitionFunction = function () {
  const { pageAbsolutePath, pageRoute } = LoaderOptionsSchema.parse(
    this.getOptions(),
  );

  const route = JSON.stringify(pageRoute);
  const path = JSON.stringify(pageAbsolutePath);

  // todo: maybe we can replace with `import`
  return `
  (window.__FRAMEWORK_P__ = window.__FRAMEWORK_P__ || []).push([
    ${route},
    function () {
      return require(${path});
    }
  ]);
  if (module.hot) {
    module.hot.dispose(function () {
      // HMR path, registering route without factory, triggers delete
      window.__FRAMEWORK_P__.push([${route}]);
    });
  }
  `;
};

export default loader;
export type { ClientPageLoaderOptions };
