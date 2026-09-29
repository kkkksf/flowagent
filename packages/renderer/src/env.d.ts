// Vite 原生 `?worker` 导入的类型声明（Monaco 本地 editor worker）。
// renderer 未直接依赖 vite，故不引用 vite/client，而以通配 ambient module 自洽声明。
declare module '*?worker' {
  const workerConstructor: new () => Worker
  export default workerConstructor
}
