import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import MiniWidget from './MiniWidget'
import './styles.css'

// The same bundle also draws the corner recording controller (a second, tiny window).
const isMini = location.hash === '#mini'
if (isMini) document.documentElement.dataset.mini = 'on'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isMini ? <MiniWidget /> : <App />}
  </React.StrictMode>
)
