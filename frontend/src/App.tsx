import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import UploadPage from './pages/UploadPage'
import DashboardPage from './pages/DashboardPage'
import DetailPage from './pages/DetailPage'

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div>
      <nav className="nav">
        <span className="nav-brand">📄 DocProcessor</span>
        <span
          className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}
          onClick={() => navigate('/')}
        >Dashboard</span>
        <span
          className={`nav-link ${location.pathname === '/upload' ? 'active' : ''}`}
          onClick={() => navigate('/upload')}
        >Upload</span>
      </nav>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/documents/:id" element={<DetailPage />} />
      </Routes>
    </div>
  )
}
