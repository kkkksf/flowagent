import './index.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { useThemeStore } from './theme-store.js'
useThemeStore.getState().init() // 渲染前同步设置 data-theme，防首帧闪烁（spec §7）
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
