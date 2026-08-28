import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SesiProvider } from './components/Akun.tsx'

// SesiProvider membungkus SELURUH aplikasi, termasuk halaman gerbang.
//
// Tombol akun berdiri di dua tempat - bilah atas gerbang dan bilah atas peta -
// dan keduanya harus membaca sesi yang sama. Kalau providernya duduk di dalam
// App di bawah gerbang, tombol di gerbang tidak punya konteks apa pun untuk
// dibaca, dan masuk dari halaman perkenalan tidak akan terbawa ke peta.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SesiProvider anak={<App />} />
  </StrictMode>,
)
