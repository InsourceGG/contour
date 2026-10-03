// @types/react-dom is not a dependency of the SDK; tests only need this one function.
declare module "react-dom/server" {
  export function renderToStaticMarkup(element: unknown): string;
}
