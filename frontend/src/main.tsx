import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SesiProvider } from './components/Akun.tsx'
import { bangunkan } from './lib/api.ts'

// Dipanggil SEBELUM render, bukan di dalam sebuah useEffect.
//
// Backend duduk di Render free tier dan tidur sesudah 15 menit menganggur.
// Yang menanggung puluhan detik cold start selalu permintaan pertama, jadi
// yang berharga di sini bukan hasilnya melainkan JAMNYA: makin awal diketuk,
// makin besar peluang ia sudah bangun saat layar pembuka benar-benar butuh.
// Sebuah efek di dalam komponen menunggu React selesai memasang pohonnya
// lebih dulu, dan itu waktu yang diberikan cuma-cuma kepada backend yang
// masih tidur.
bangunkan()

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
