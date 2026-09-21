import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SesiProvider } from './components/Akun.tsx'
import { bangunkan } from './lib/api.ts'
import { siapkanKunciBasemap } from './config.ts'
import { BahasaProvider, TemaProvider } from './lib/bahasa.tsx'

bangunkan()
// Kunci basemap untuk terbitan yang dibangun tanpa kunci - diminta sedini
// mungkin, peta menunggunya sebelum ubin pertama (lihat PetaInteraktif).
void siapkanKunciBasemap()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TemaProvider>
      <BahasaProvider>
        <SesiProvider anak={<App />} />
      </BahasaProvider>
    </TemaProvider>
  </StrictMode>,
)
