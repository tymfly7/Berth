import { BrowserRouter, Routes, Route } from 'react-router-dom'
import PublicView from './pages/PublicView'
import AdminView from './pages/AdminView'
import PinGate from './components/PinGate'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PublicView />} />
        <Route path="/admin" element={<PinGate><AdminView /></PinGate>} />
      </Routes>
    </BrowserRouter>
  )
}
