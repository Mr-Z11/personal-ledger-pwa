/// <reference types="vite/client" />

/** 构建时由 vite.config.ts 的 define 注入：git 短 hash / 构建时间（ISO） */
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
