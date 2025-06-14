/// <reference types="vite/client" />

// 声明 CSS inline 导入的类型
declare module '*.css?inline' {
  const content: string;
  export default content;
} 